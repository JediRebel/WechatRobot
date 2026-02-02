// scripts/summarize-long-news.ts
/* eslint-disable no-console */
import fs from "fs"
import path from "path"
import minimist from "minimist"
import "dotenv/config"
import { getUnprocessedNews } from "../src/utils/db"

const argv = minimist(process.argv.slice(2), {
  string: ["output", "model", "apiBase", "input", "maxTokens"],

  default: {
    output: "out/long-post.txt",
    model: "gpt-5.2",
    maxTokens: "8000",
  },
})

const model = String(argv.model || "gpt-5.2")

const maxTokensRaw = argv.maxTokens
const maxTokensParsed = Number.parseInt(String(maxTokensRaw), 10)
const maxTokens =
  Number.isFinite(maxTokensParsed) && maxTokensParsed > 0
    ? Math.min(maxTokensParsed, 12000) // 这里可以设置上限
    : 8000
console.log(`🧾 maxTokens=${maxTokens} (raw=${String(maxTokensRaw)})`)
const apiKey = process.env.OPENAI_API_KEY
const apiBase =
  (argv.apiBase || process.env.OPENAI_BASE || "").replace(/\/$/, "") ||
  "https://api.openai.com"

if (!apiKey) {
  console.error("❌ 缺少 OPENAI_API_KEY 环境变量")
  process.exit(1)
}

const outputPath = path.resolve(argv.output)

/**
 * [增强] 支持双模式加载数据
 * 1. 优先检查是否提供了 --input (测试模式)
 * 2. 如果没有，则从数据库读取 (生产模式)
 */

async function loadNewsData() {
  const inputPath = argv.input

  if (inputPath && fs.existsSync(inputPath)) {
    console.log(`🧪 [TESTING] 正在从测试文件加载预览数据: ${inputPath}`)
    try {
      const rawData = fs.readFileSync(inputPath, "utf-8")
      const items = JSON.parse(rawData)

      // 兼容 fetch-all 输出的两种格式 (aggregated 或 扁平化 list)
      const finalItems = Array.isArray(items)
        ? items
        : items.flatMap
        ? items.flatMap((g: any) => g.items)
        : []

      console.log(`🧾 maxTokens=${maxTokens} (raw=${String(maxTokensRaw)})`)

      if (finalItems.length === 0) {
        console.warn("⚠️ 测试文件中没有新闻数据。")
        process.exit(0)
      }
      console.log(`统计：从测试文件提取了 ${finalItems.length} 条新闻。`)
      return finalItems
    } catch (err) {
      console.error("❌ 解析测试文件失败:", err)
      process.exit(1)
    }
  }
  console.log(`🤖 model=${model} (raw=${String(argv.model)})`)
  // 生产模式：读取数据库
  console.log("读取数据库中未处理的新闻...")
  const dbItems = await getUnprocessedNews()

  if (dbItems.length === 0) {
    console.warn("⚠️ 数据库中没有未处理的新闻条目。")
    process.exit(0)
  }

  console.log(`统计：从数据库提取了 ${dbItems.length} 条唯一新闻。`)
  return dbItems
}

// 核心修复：保持 callOpenAI 逻辑不变
async function callOpenAI(prompt: string): Promise<string> {
  const maxAttempts = 3
  let lastErr: Error | undefined

  for (let i = 1; i <= maxAttempts; i++) {
    try {
      const res = await fetch(`${apiBase}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          // model: argv.model,
          // gpt-5.x 系列需要用 max_completion_tokens；旧模型仍用 max_tokens。
          ...(model.startsWith("gpt-5")
            ? { max_completion_tokens: maxTokens }
            : { max_tokens: maxTokens }),
          messages: [
            {
              role: "system",
              content: "你是一个深度新闻编辑助手，擅长长文翻译与核心提要总结。",
            },
            { role: "user", content: prompt },
          ],
        }),
      })

      if (!res.ok) {
        const text = await res.text()
        throw new Error(`OpenAI API error ${res.status}: ${text}`)
      }

      const json = await res.json()
      const choice = json.choices?.[0]
      const result = choice?.message?.content
      if (!result) {
        throw new Error(
          `OpenAI API 返回内容为空。raw=${JSON.stringify(json).slice(0, 800)}`,
        )
      }

      return result as string
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err))
      if (i < maxAttempts) {
        await new Promise((r) => setTimeout(r, 2000 * i))
        continue
      }
    }
  }
  throw lastErr || new Error("Unknown error in callOpenAI")
}

async function main() {
  const groups = await loadNewsData()

  // 确保输出目录存在并清空旧文件（单跑和 pipeline 都安全）
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, "", "utf8")

  console.log("📤 调用 OpenAI 生成长篇深度文案（可自动分片）...")
  await generateInParts(groups, 1)

  console.log(`✅ 长文案已生成: ${outputPath}`)
}

main().catch((err) => {
  console.error("❌ 生成失败:", err.message)
  process.exit(1)
})

/** 构造提示词，给定任意子集 */
function buildPrompt(subset: any[]): string {
  return `
你是一位资深的海外华人社区新闻主编。请处理以下 JSON 新闻列表，为微信公众号创作深度资讯。

### 🚨 第一步：严格查重（核心任务）
1. 扫描所有新闻。如果多条新闻描述的是**同一个事件**（例如：多个来源报道了同一个人物、同一个事件或同一场活动），**必须合并为一条报道**。
2. 严禁对同一事件输出两条记录。
3. 合并时，请整合不同来源的细节，链接只保留优先级最高的一个。
4. 除了合并同一事件外，不得因篇数、板块数量等原因省略任何事件；仅在接近模型 token 上限时才停止追加，已开始的单条不得截断。

### 📋 第二步：板块归类
将合并后的新闻归入以下板块：🛡️【治安防范】、🏗️【市政规划】、🍎【社区教育】、⚡【生活服务】、❄️【天气景观】。

### 🌐 翻译规则（严格执行）
- 仅以下地名按指定译名替换：New Brunswick → 新不伦瑞克；Moncton → 蒙克顿；Fredericton → 弗莱；Saint John → 圣约翰。
- 其他所有人名、地名一律不翻译，保持原英文或法文写法。

### ✍️ 第三步：深度写作格式（严格执行标签，这是程序解析的关键）
针对每一条新闻，必须且只能按以下格式输出，不得漏掉任何 [TAG]：

[TITLE_START] 【此处是中文标题，须包含新闻核心动词，15字以内】 [TITLE_END]
[BODY_START]
此处是 400-600 字的长篇深度报道。
- 要求：涵盖时间、地点、人名、地名、起因、经过、结果及影响。确保读者无需看原文也能掌握全部细节。
- 语言风格：专业中文。但**地名、人名等专有名词，必须使用英文或法文原文**。
- 段落：每段首行不空格，段落之间空一行。
[BODY_END]
原文链接：URL
---END_OF_ARTICLE---

### ❌ 禁止行为：
- 禁止输出任何前言、开场白或解释。
- 禁止输出重复的新闻。

JSON 数据：
${JSON.stringify(subset, null, 2)}
`
}

function isContextError(err: unknown): boolean {
  const msg = (err as Error)?.message || ""
  return (
    msg.includes("maximum context length") ||
    msg.includes("context_length_exceeded") ||
    msg.includes("This model's maximum context length") ||
    msg.includes("exceeds the maximum") ||
    msg.includes("返回内容为空")
  )
}

/**
 * 分片生成：若触发上下文超长，自动把输入拆半递归重试。
 * 每个成功批次都会 append 到 outputPath，并保留顺序。
 */
async function generateInParts(items: any[], partNo: number): Promise<void> {
  if (items.length === 0) return
  try {
    const prompt = buildPrompt(items)
    const content = await callOpenAI(prompt)
    const trimmed = content.trim()
    fs.appendFileSync(
      outputPath,
      `${trimmed}${trimmed.endsWith("\n") ? "" : "\n"}\n`,
      "utf8",
    )
    console.log(`✅ 已生成第 ${partNo} 部分（输入 ${items.length} 条）`)
  } catch (err) {
    if (isContextError(err) && items.length > 1) {
      const mid = Math.ceil(items.length / 2)
      const left = items.slice(0, mid)
      const right = items.slice(mid)
      console.warn(
        `⚠️ 第 ${partNo} 部分触发上下文超长，拆分为 ${left.length} + ${right.length} 条再试...`,
      )
      await generateInParts(left, partNo)
      await generateInParts(right, partNo + 1)
    } else {
      throw err
    }
  }
}
