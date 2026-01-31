// scripts/fetch-news.ts
// 一键完成：抓取 -> 生成文案 -> 发送企业微信
import "dotenv/config"
import { execSync } from "child_process"
import path from "path"
import minimist from "minimist" // 确保已安装: npm install minimist

// 解析命令行参数
const argv = minimist(process.argv.slice(2), {
  boolean: ["long"],
  alias: { l: "long" },
  default: { long: false },
})

function run(cmd: string) {
  console.log(`\n$ ${cmd}`)
  execSync(cmd, { stdio: "inherit" })
}

async function main() {
  const requiredEnv = ["OPENAI_API_KEY", "WECOM_WEBHOOK"] as const
  for (const key of requiredEnv) {
    if (!process.env[key]) {
      console.error(`❌ Missing env: ${key}`)
      process.exit(1)
    }
  }

  // 根据参数决定文件名
  const isLongMode = argv.long
  const jsonFile = isLongMode ? "long-news.json" : "news.json"
  const postFile = isLongMode ? "long-post.txt" : "post.txt"

  const jsonPath = path.join("out", jsonFile)
  const postPath = path.join("out", postFile)

  // 1) 抓取逻辑：根据模式存入对应的 JSON
  run(
    `npx ts-node -r tsconfig-paths/register -r dotenv/config scripts/fetch-all.ts ` +
      `--windowHours 24 --json "${jsonPath}" --show 999`,
  )

  // 2) 总结逻辑：使用对应的脚本和输出文件
  const summaryScript = isLongMode
    ? "summarize-long-news.ts"
    : "summarize-news.ts"

  console.log(
    `\n模式确认: ${isLongMode ? "【长篇深度模式】" : "【短篇摘要模式】"}`,
  )

  run(
    `npx ts-node -r dotenv/config scripts/${summaryScript} ` +
      `--input "${jsonPath}" --output "${postPath}" --model gpt-4o-mini`,
  )

  // 3) 发送逻辑：仅在【短篇模式】下发送到企业微信
  if (!isLongMode) {
    run(
      `npx ts-node -r dotenv/config scripts/send-to-wechat.ts ` +
        `--file "${postPath}"`,
    )
  } else {
    // 【长篇模式】保存本地并发布到公众号
    console.log(`\n🎉 长篇内容已保存至: ${postPath}`)

    // ✅ 新增：执行公众号发布，并带上 --long 参数
    run(`npx ts-node -r dotenv/config scripts/publish-mp.ts --long`)
  }
}

// 修正点：删除了之前在 main() 函数外面的多余 run 命令

main().catch((err) => {
  console.error("❌ run-all failed:", err)
  process.exit(1)
})
