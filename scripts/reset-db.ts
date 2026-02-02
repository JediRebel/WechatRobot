//彻底清空数据库

import { updateNewsStatus, getUnprocessedNews } from "../src/utils/db"

async function reset() {
  const news = await getUnprocessedNews()
  const urls = news.map((n) => n.link)
  if (urls.length > 0) {
    console.log(`正在将 ${urls.length} 条旧新闻标记为已处理...`)
    await updateNewsStatus(urls, 1)
    console.log("✅ 数据库已清空。")
  } else {
    console.log("数据库中没有未处理的新闻。")
  }
}
reset()
