// scripts/run-pipeline.ts
import "dotenv/config"
import { execSync } from "child_process"
import path from "path"
import fs from "fs"
import minimist from "minimist"

const argv = minimist(process.argv.slice(2), {
  boolean: ["long", "prod"], // 🚨 新增 prod 参数支持
  alias: { l: "long", p: "prod" },
  default: { long: undefined, prod: false },
})

function run(cmd: string) {
  console.log(`\n$ ${cmd}`)
  execSync(cmd, { stdio: "inherit" })
}

async function main() {
  console.log("收到原始参数:", process.argv.slice(2))

  const isLongMode = argv.long === true
  const isProd = argv.prod === true // 🚨 记录生产模式状态

  console.log(
    `\n模式确认: ${
      isLongMode ? "【长篇深度模式 - 公众号】" : "【短篇摘要模式 - 企业微信】"
    } | 运行环境: ${isProd ? "🚀 [PRODUCTION - 生产]" : "🧪 [TESTING - 测试]"}`,
  )

  // 安全性检查
  const requiredEnv = isLongMode
    ? ["OPENAI_API_KEY", "WECHAT_APP_ID", "WECHAT_APP_SECRET"]
    : ["OPENAI_API_KEY", "WECOM_WEBHOOK"]

  for (const key of requiredEnv) {
    if (!process.env[key]) {
      console.error(`❌ 缺少必要环境变量: ${key}`)
      process.exit(1)
    }
  }

  const postFile = isLongMode ? "long-post.txt" : "post.txt"
  const postPath = path.join("out", postFile)

  // 1. 清理旧文件
  const filesToClean = [
    "post.txt",
    "long-post.txt",
    "news.json",
    "long-news.json",
  ]
  filesToClean.forEach((file) => {
    const p = path.join("out", file)
    if (fs.existsSync(p)) {
      try {
        fs.unlinkSync(p)
        console.log(`\n🧹 已清理旧文件: ${file}`)
      } catch (err) {
        console.warn(
          `⚠️ 无法清理文件 ${file}:`,
          err instanceof Error ? err.message : String(err),
        )
      }
    }
  })

  // 2. 抓取逻辑
  const windowHours = argv.windowHours || 24
  // 🚨 传递 --prod 参数给 fetch-all.ts
  run(
    `npx ts-node -r tsconfig-paths/register -r dotenv/config scripts/fetch-all.ts ` +
      `--windowHours ${windowHours} --show 999 ${isProd ? "--prod" : ""}`,
  )

  // 3. 总结逻辑
  const summaryScript = isLongMode
    ? "summarize-long-news.ts"
    : "summarize-news.ts"
  const testJsonPath = path.join("out", "latest-fetch-test.json")
  console.log(`\n✍️ 开始生成总结文案...`)
  try {
    // 🚨 关键改动：如果是测试模式且抓取文件存在，则透传 --input
    const inputArg =
      !isProd && fs.existsSync(testJsonPath) ? `--input "${testJsonPath}"` : ""
    run(
      `npx ts-node -r dotenv/config scripts/${summaryScript} ` +
        `--output "${postPath}" --model gpt-4o-mini ${inputArg}`,
    )
  } catch (err) {
    if (!fs.existsSync(postPath)) {
      console.log(`\n☕️ 任务结束：数据库中没有需要处理的新闻条目。`)
      process.exit(0)
    }
    throw err
  }

  // 4. 发送/发布逻辑 (无论是否 prod 都会执行，方便测试发布接口)
  if (!fs.existsSync(postPath)) {
    console.log(`\n☕️ 未生成新文案，流程自动结束。`)
    process.exit(0)
  }

  if (!isLongMode) {
    console.log(`\n🚀 准备发送到企业微信...`)
    run(
      `npx ts-node -r dotenv/config scripts/send-to-wechat.ts --file "${postPath}"`,
    )
    if (!isProd) console.log(`\n💡 [TESTING] 已完成企微发送测试。`)
  } else {
    console.log(`\n🎉 长篇内容已保存至: ${postPath}`)

    // 满足你的需求：即使不是 prod，也会提示并执行发布草稿
    console.log(
      `\n🚀 [${isProd ? "PRODUCTION" : "TESTING"}] 准备发布到公众号草稿...`,
    )
    run(
      `npx ts-node -r dotenv/config scripts/publish-mp.ts --long ${
        isProd ? "--prod" : ""
      }`,
    )

    if (isProd) {
      console.log(`\n✅ 所有生产发布任务已圆满完成！`)
    } else {
      console.log(`\n✅ [TESTING] 测试草稿已成功生成，数据库状态未更新。`)
    }
  }
}

main().catch((err) => {
  console.error(
    "❌ run-pipeline 失败，流程已终止:",
    err instanceof Error ? err.message : String(err),
  )
  process.exit(1)
})
