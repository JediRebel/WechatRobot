// scripts/publish-mp.ts
// 功能：自动上传封面图 -> 创建公众号草稿 -> 预览/群发
import "dotenv/config"
import fs from "fs"
import path from "path"
import minimist from "minimist"
import FormData from "form-data" // 需安装：npm install form-data
import axios from "axios"
import { addDraft, sendAll, sendPreview } from "../src/wechat/wechat-mp-service"
import { wechatMpClient } from "../src/wechat/mp-client"

// 解析命令行参数
const argv = minimist(process.argv.slice(2), {
  boolean: ["long"],
  default: { long: false },
})

const PREVIEW_OPENID = process.env.WECHAT_PREVIEW_OPENID || ""

/**
 * ✅ 新增：上传本地图片到微信永久素材库，获取 thumb_media_id
 * 建议在项目根目录准备一个 assets/cover.jpg 作为默认封面
 */
async function uploadPermanentImage(localPath: string): Promise<string> {
  if (!fs.existsSync(localPath)) {
    throw new Error(`封面图不存在: ${localPath}，请在指定位置放置图片文件。`)
  }

  const accessToken = await wechatMpClient.getAccessToken()
  // 微信永久素材上传接口
  const url = `https://api.weixin.qq.com/cgi-bin/material/add_material?access_token=${accessToken}&type=image`

  const form = new FormData()
  form.append("media", fs.createReadStream(localPath))

  console.log(`正在上传封面图: ${localPath}...`)
  const resp = await axios.post(url, form, {
    headers: form.getHeaders(),
  })

  if (resp.data.errcode) {
    throw new Error(`图片上传失败: ${resp.data.errcode} ${resp.data.errmsg}`)
  }

  console.log(`✅ 封面图上传成功, media_id: ${resp.data.media_id}`)
  return resp.data.media_id
}

function buildArticle(content: string, isLong: boolean, thumbMediaId: string) {
  const today = new Date().toISOString().slice(0, 10)
  const title = isLong ? `本地每日消息 ${today}` : `本地要闻 ${today}`
  const digest = content.slice(0, 120).replace(/\n/g, " ")

  // 1. 使用明确的标记分割条目，不再依赖不稳定的换行
  const entries = content
    .split(/---END_OF_ARTICLE---/)
    .map((e) => e.trim())
    .filter(Boolean)

  const html = entries
    .map((entry) => {
      // 提取链接的正则：兼容纯文本和 Markdown
      const urlRegex = /https?:\/\/[^\s\)\]]+/
      const match = entry.match(urlRegex)

      let cleanEntry = entry
      let linkText = ""

      if (match) {
        const actualUrl = match[0]
        // 彻底清理：删除所有包含 URL 的行以及 Markdown 符号
        cleanEntry = entry
          .replace(/^.*原文链接.*$/gm, "")
          .replace(/\[链接\]/g, "")
          .replace(/\(https?:\/\/.*?\)/g, "")
          .replace(/https?:\/\/[^\s\)\]]+/g, "")
          .trim()

        linkText = `<p style="margin-top: 15px; font-size: 13px; color: #888; word-break: break-all;">
                    原文链接（复制查看）：<br/>${actualUrl}
                  </p>`
      }

      // 2. 将正文转为段落，保持 1.8 倍行高以利于长文阅读
      const paragraphs = cleanEntry
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map(
          (line) =>
            `<p style="margin-bottom: 12px; line-height: 1.8; color: #333; text-align: justify;">${line}</p>`,
        )
        .join("")

      // 恢复底部分割线，以增强长文阅读的节奏感
      return `<section style="margin-bottom: 35px; padding-bottom: 20px; border-bottom: 1px solid #f0f0f0;">
              ${paragraphs}
              ${linkText}
            </section>`
    })
    .join("\n")

  return {
    title,
    content: html,
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

  // 封面图路径，建议你在项目里放一个固定图片
  const coverPath = path.resolve("assets/cover.jpg")

  if (!fs.existsSync(filePath)) {
    console.error(`❌ 未找到文案文件: ${fileName}`)
    process.exit(1)
  }

  const content = fs.readFileSync(filePath, "utf8").trim()
  if (!content) {
    console.error(`❌ ${fileName} 文案内容为空`)
    process.exit(1)
  }

  try {
    // 1. 全自动上传图片获取必需的 MediaID
    const thumbMediaId = await uploadPermanentImage(coverPath)

    // 2. 创建草稿
    console.log(`🚀 正在为${isLong ? "【长篇】" : "【短篇】"}创建公众号草稿...`)
    const article = buildArticle(content, isLong, thumbMediaId)
    const mediaId = await addDraft([article])
    console.log(`✅ 草稿已创建，media_id=${mediaId}`)

    // 3. 发布逻辑：配置了预览 ID 则预览，否则正式群发
    // if (PREVIEW_OPENID) {
    //   await sendPreview(mediaId, PREVIEW_OPENID)
    //   console.log(`✅ 预览已发送至手机，请查收。`)
    // } else {
    //   console.log("⚠️ 未配置预览 ID，正在尝试正式群发...")
    //   await sendAll(mediaId)
    //   console.log("✅ 文章已正式群发给所有订阅者！")
    // }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    console.error("❌ 公众号发布全流程失败:", errorMessage)
    process.exit(1)
  }
}

main()
