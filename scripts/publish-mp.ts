// scripts/publish-mp.ts
import "dotenv/config"
import fs from "fs"
import path from "path"
import minimist from "minimist"
import FormData from "form-data"
import axios from "axios"
import { addDraft, sendAll, sendPreview } from "../src/wechat/wechat-mp-service"
import { wechatMpClient } from "../src/wechat/mp-client"
import { updateNewsStatus } from "../src/utils/db" // [新增] 引入数据库更新函数

const argv = minimist(process.argv.slice(2), {
  boolean: ["long", "prod", "preview"],
  string: ["previewOpenid"],
  default: { long: false, prod: false, preview: false },
})

const PREVIEW_OPENID =
  argv.previewOpenid || process.env.WECHAT_PREVIEW_OPENID || ""

async function uploadPermanentImage(localPath: string): Promise<string> {
  if (!fs.existsSync(localPath)) {
    throw new Error(`封面图不存在: ${localPath}`)
  }
  const accessToken = await wechatMpClient.getAccessToken()
  const url = `https://api.weixin.qq.com/cgi-bin/material/add_material?access_token=${accessToken}&type=image`
  const form = new FormData()
  form.append("media", fs.createReadStream(localPath))
  console.log(`正在上传封面图: ${localPath}...`)
  const resp = await axios.post(url, form, { headers: form.getHeaders() })
  if (resp.data.errcode) throw new Error(`图片上传失败: ${resp.data.errcode}`)
  return resp.data.media_id
}

/**
 * [新增辅助函数] 从文案中提取所有原文链接
 */
function extractUrls(content: string): string[] {
  const urlRegex = /https?:\/\/[^\s\)\]]+/g
  const matches = content.match(urlRegex)
  return matches ? Array.from(new Set(matches)) : []
}

function buildArticle(content: string, isLong: boolean, thumbMediaId: string) {
  const today = new Date().toISOString().slice(0, 10)
  const title = isLong ? `NB省本地每日资讯 ${today}` : `本地要闻 ${today}`

  // 摘要逻辑：截取前120字并清理
  const digest = content
    .replace(/\[.*?\]/g, "")
    .slice(0, 120)
    .replace(/\n/g, " ")

  const welcomeHeader = `
    <section style="margin-bottom: 25px; padding: 15px; background-color: #f8f8f8; border-radius: 8px; border-left: 4px solid #007aff;">
      <p style="margin: 0; font-weight: bold; color: #333; line-height: 1.6;">建设本地华人首选的信息渠道，欢迎每日查阅！</p>
      <p style="margin: 8px 0 0 0; font-size: 14px; color: #666; line-height: 1.6;">每周一到周六，我们都会发布过去24小时，加拿大New Brunswick省本地资讯，帮您了解正在发生的事情，解决语言壁垒导致的信息不畅。所有资讯来自主流可信渠道。</p>
    </section>
  `

  const entries = content
    .split(/---END_OF_ARTICLE---/)
    .map((e) => e.trim())
    .filter(Boolean)

  const bodyHtml = entries
    .map((entry) => {
      // 🔍 正则匹配标题和正文标签
      const titleRegex = /(?:\*\*|\[)TITLE_START(?:\]|\*\*)\s*([^]*?)\s*(?:\*\*|\[)TITLE_END(?:\]|\*\*)/i
      const bodyRegex = /(?:\*\*|\[)BODY_START(?:\]|\*\*)\s*([^]*?)\s*(?:\*\*|\[)BODY_END(?:\]|\*\*)/i

      const titleMatch = entry.match(titleRegex)
      const bodyMatch = entry.match(bodyRegex)
      const urlMatch = entry.match(/https?:\/\/[^\s\)\]]+/)

      let newsTitle = "本地动态"
      if (titleMatch && titleMatch[1]) {
        newsTitle = titleMatch[1].replace(/[【】\*]/g, "").trim()
      } else {
        const firstLine = entry.split("\n")[0]
        newsTitle = firstLine
          .replace(/\[?TITLE_START\]?|\[?TITLE_END\]?|\*/gi, "")
          .replace(/[【】]/g, "")
          .trim()
      }

      let newsBody = bodyMatch ? bodyMatch[1].trim() : entry
      newsBody = newsBody
        .replace(/\[?TITLE_START\]?.*?\[?TITLE_END\]?/gi, "")
        .replace(/\[?BODY_START\]?|\[?BODY_END\]?/gi, "")
        .replace(/\*\*/g, "")
        .replace(/^.*(?:原文链接|https?:\/\/).*$/gm, "")
        .trim()

      const actualUrl = urlMatch ? urlMatch[0] : ""

      const paragraphs = newsBody
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map(
          (line) =>
            `<p style="margin-bottom: 15px; line-height: 1.8; color: #333; font-size: 16px; text-align: justify;">${line}</p>`,
        )
        .join("")

      const linkHtml = actualUrl
        ? `
      <div style="margin-top: 20px; padding: 12px; background: #fdfdfd; border: 1px dashed #ccc; border-radius: 6px;">
        <p style="font-size: 13px; color: #999; margin: 0;">原文链接（复制查看）：</p>
        <p style="font-size: 12px; color: #576b95; word-break: break-all; margin-top: 5px;">${actualUrl}</p>
      </div>`
        : ""

      return `
      <section style="margin-bottom: 45px; padding-bottom: 25px; border-bottom: 1px solid #f0f0f0;">
        <h3 style="font-size: 20px; font-weight: bold; color: #000; margin-bottom: 18px; border-left: 5px solid #07c160; padding-left: 12px; line-height: 1.4;">
          ${newsTitle}
        </h3>
        ${paragraphs}
        ${linkHtml}
      </section>
    `
    })
    .join("\n")

  return {
    title,
    content: welcomeHeader + bodyHtml,
    digest,
    author: "NB小灵通",
    thumb_media_id: thumbMediaId,
    show_cover_pic: 1 as const,
  }
}

async function main() {
  const isLong = argv.long
  const fileName = isLong ? "out/long-post.txt" : "out/post.txt"
  const filePath = path.resolve(fileName)
  const coverPath = path.resolve("assets/cover.jpg")

  if (!fs.existsSync(filePath)) {
    console.error(`❌ 未找到文案文件: ${fileName}`)
    process.exit(1)
  }
  const content = fs.readFileSync(filePath, "utf8").trim()
  if (!content) {
    console.error(`❌ ${fileName} 内容为空`)
    process.exit(1)
  }

  try {
    const thumbMediaId = await uploadPermanentImage(coverPath)
    console.log(`🚀 正在为${isLong ? "【长篇】" : "【短篇】"}创建草稿...`)
    const article = buildArticle(content, isLong, thumbMediaId)
    const mediaId = await addDraft([article])
    console.log(`✅ 草稿已创建: ${mediaId}`)

    // 可选：发送预览
    if (argv.preview) {
      if (!PREVIEW_OPENID) {
        throw new Error(
          "预览模式需要提供 openid：请设置 WECHAT_PREVIEW_OPENID 或传 --previewOpenid",
        )
      }
      console.log(`👀 发送预览给 ${PREVIEW_OPENID} ...`)
      await sendPreview(mediaId, PREVIEW_OPENID)
      console.log("✅ 预览消息已发送，请在微信里检查效果。")
    }

    // [新增] 发布成功后，更新数据库状态
    const urls = extractUrls(content)

    if (argv.prod) {
      console.log(
        `💾 [PRODUCTION] 正在更新数据库，标记 ${urls.length} 条新闻为已发布...`,
      )
      await updateNewsStatus(urls, 1)
      console.log(`✅ 数据库状态更新完成。`)
    } else {
      console.log(`🧪 [TESTING] 已跳过数据库状态更新，新闻仍保持“未发布”状态。`)
    }
  } catch (err) {
    console.error("❌ 发布失败:", err)
    process.exit(1)
  }
}

main()
