// scripts/summarize-long-news.ts
/* eslint-disable no-console */
import fs from "fs"
import path from "path"
import minimist from "minimist"
import "dotenv/config"

const argv = minimist(process.argv.slice(2), {
  string: ["input", "output", "model", "apiBase"],
  default: {
    input: "out/news.json",
    output: "out/long-post.txt",
    model: "gpt-4o-mini",
    maxTokens: 6000,
  },
})

const apiKey = process.env.OPENAI_API_KEY
const apiBase =
  (argv.apiBase || process.env.OPENAI_BASE || "").replace(/\/$/, "") ||
  "https://api.openai.com"

if (!apiKey) {
  console.error("❌ 缺少 OPENAI_API_KEY 环境变量")
  process.exit(1)
}

const inputPath = path.resolve(argv.input)
const outputPath = path.resolve(argv.output)

function loadNews() {
  if (!fs.existsSync(inputPath)) {
    console.error(`❌ 找不到输入文件: ${inputPath}`)
    process.exit(1)
  }

  const raw = fs.readFileSync(inputPath, "utf8")
  const data = JSON.parse(raw)

  // 1. 提取所有新闻条目并进行 URL 硬去重
  const uniqueItemsMap = new Map()

  data.forEach((group: any) => {
    if (group.items && Array.isArray(group.items)) {
      group.items.forEach((item: any) => {
        // 如果链接已存在，则根据来源优先级决定是否替换（可选增强）
        // 这里采用简单的“先到先得”去重，或直接以 URL 为准
        if (!uniqueItemsMap.has(item.link)) {
          uniqueItemsMap.set(item.link, item)
        }
      })
    }
  })

  // 2. 将去重后的扁平化列表返回
  // 提示：将嵌套的 Group 结构扁平化为 Array<Item>，更有利于 AI 扫描
  const finalItems = Array.from(uniqueItemsMap.values())

  if (finalItems.length === 0) {
    console.warn("⚠️ 没有抓取到任何新闻条目。")
    process.exit(0)
  }

  console.log(`统计：从原始数据中提取了 ${finalItems.length} 条唯一新闻。`)
  return finalItems
}

// 核心修复：添加返回类型声明并在循环中 return 结果
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
          model: argv.model,
          max_tokens: 6000,
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
      const result = json.choices?.[0]?.message?.content
      if (!result) throw new Error("OpenAI API 返回内容为空")

      return result as string // 成功时必须 return
    } catch (err) {
      // 类型守卫修复
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
  const groups = loadNews()

  // 🚨 核心改进：将最新的深度报道提示词直接整合
  const prompt = `
你是一位资深的海外华人社区新闻主编。请处理以下 JSON 新闻列表，为微信公众号创作深度资讯。

### 🚨 第一步：严格查重（核心任务）
1. 扫描所有新闻。如果多条新闻描述的是**同一个事件**（例如：多个来源报道了同一个人物、同一个事件或同一场活动），**必须合并为一条报道**。
2. 严禁对同一事件输出两条记录。
3. 合并时，请整合不同来源的细节，链接只保留优先级最高的一个。


### 📋 第二步：板块归类
将合并后的新闻归入以下板块：🛡️【治安防范】、🏗️【市政规划】、🍎【社区教育】、⚡【生活服务】、❄️【天气景观】。

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
${JSON.stringify(groups, null, 2)}
`

  console.log("📤 调用 OpenAI 生成长篇深度文案...")
  const content = await callOpenAI(prompt)

  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, content.trim(), "utf8")
  console.log(`✅ 长文案已生成: ${outputPath}`)
}

main().catch((err) => {
  console.error("❌ 生成失败:", err.message)
  process.exit(1)
})
