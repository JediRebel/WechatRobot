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
    output: "out/post-long.txt",
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
  return data.filter((g: any) => g.items && g.items.length)
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
          max_tokens: Number(argv.maxTokens),
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

  const prompt = `你是一位深度新闻主编。请处理以下 JSON 新闻列表，生成一份极度详尽的报道。

**严格写作规则**：
1) **内容深度**：每条新闻必须是一篇完整的深度报道。
   - 严禁简单概括！必须包含事件的起因、精确的时间地点、核心人物言论、多方背景分析。
   - 字数要求：每条新闻的中文正文必须在 400-500 字之间。如果原文不足，请直接翻译原文。
2) **结构要求**：
   - 【标题】：吸睛的中文标题（15字内）。不需要在文中显示“标题”字样
   - 【正文】：分段叙述，逻辑清晰。不需要在文中显示“正文”字样
   - 【来源】：末尾必须单独一行写“原文链接：URL”。不需要在文中显示“来源”字样
3) **输出格式控制（极其重要）**：
   - 每条新闻结束后，必须紧跟一行字符串：---END_OF_ARTICLE---
   - 禁止输出任何前言、后记或“好的，这是为您整理的新闻”。
4) **翻译要求（极其重要）**：
   - 所有的人名、地名等专有名词，均不翻译成中文。

JSON 数据：
${JSON.stringify(groups, null, 2)}
`

  console.log("📤 调用 OpenAI 生成长篇深度文案...")
  const content = await callOpenAI(prompt)

  // 此时 content 是 string 类型，trim() 不再报错
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, content.trim(), "utf8")
  console.log(`✅ 长文案已生成: ${outputPath}`)
}

main().catch((err) => {
  console.error("❌ 生成失败:", err.message)
  process.exit(1)
})
