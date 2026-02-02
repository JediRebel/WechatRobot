// src/utils/db.ts
import initSqlJs from "sql.js"
import fs from "fs"
import path from "path"

const dbDir = path.resolve(process.cwd(), "data")
const dbPath = path.join(dbDir, "news.db")

let dbInstance: any = null
let SQL: any = null

async function getDb() {
  if (dbInstance) return dbInstance
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true })
  if (!SQL) SQL = await initSqlJs()

  if (fs.existsSync(dbPath)) {
    const fileBuffer = fs.readFileSync(dbPath)
    dbInstance = new SQL.Database(fileBuffer)
  } else {
    dbInstance = new SQL.Database()
  }

  dbInstance.run(`
    CREATE TABLE IF NOT EXISTS news_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT UNIQUE,
      title TEXT,
      source_id TEXT,
      publish_date TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      status INTEGER DEFAULT 0,
      cluster_key TEXT
    )
  `)
  return dbInstance
}

function persist(db: any) {
  const data = db.export()
  const buffer = Buffer.from(data)
  fs.writeFileSync(dbPath, buffer)
}

/**
 * 批量保存抓取到的新闻条目
 * 增强：支持 cluster_key 语义去重，并自动继承已发布状态
 */
export async function saveNewsItems(
  items: Array<{
    title: string
    link: string
    source: string
    date?: Date
    cluster_key?: string
  }>,
) {
  const db = await getDb()

  // 💡 插入逻辑：通过 cluster_key 检查是否已有相同事件被标记为已处理 (status=1)
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO news_items (url, title, source_id, publish_date, cluster_key, status) 
    VALUES (?, ?, ?, ?, ?, 
      COALESCE((SELECT status FROM news_items WHERE cluster_key = ? AND status = 1 LIMIT 1), 0)
    )
  `)

  for (const it of items) {
    try {
      const ck = it.cluster_key || it.title
      stmt.run([
        it.link,
        it.title,
        it.source,
        it.date ? it.date.toISOString() : null,
        ck,
        ck, // 对应子查询中的 cluster_key = ?
      ])
    } catch (err) {
      console.error(`❌ DB Insert Error [${it.title}]:`, err)
    }
  }

  stmt.free()
  persist(db)
}

/**
 * 批量更新新闻状态
 * 增强版：当一个 URL 被发布，所有相同 cluster_key 的新闻全部标记为已发布
 */
export async function updateNewsStatus(urls: string[], status: number) {
  if (urls.length === 0) return
  const db = await getDb()

  const stmtUrl = db.prepare("UPDATE news_items SET status = ? WHERE url = ?")
  const stmtCluster = db.prepare(`
    UPDATE news_items SET status = ? 
    WHERE cluster_key IN (SELECT cluster_key FROM news_items WHERE url = ?)
  `)

  for (const url of urls) {
    try {
      stmtCluster.run([status, url])
      stmtUrl.run([status, url])
    } catch (err) {
      console.error(`❌ 更新状态失败 [${url}]:`, err)
    }
  }

  stmtUrl.free()
  stmtCluster.free()
  persist(db)
}

export async function getUnprocessedNews(): Promise<any[]> {
  const db = await getDb()
  const res = db.exec(
    "SELECT url as link, title, source_id as source, publish_date as date FROM news_items WHERE status = 0 ORDER BY publish_date DESC",
  )

  if (res.length === 0) return []
  const columns = res[0].columns
  const values = res[0].values
  return values.map((row: any) => {
    const obj: any = {}
    columns.forEach((col: string, i: number) => {
      obj[col] = row[i]
    })
    return obj
  })
}

export async function isNewsExists(url: string): Promise<boolean> {
  const db = await getDb()
  const res = db.exec("SELECT id FROM news_items WHERE url = ?", [url])
  return res.length > 0 && res[0].values.length > 0
}
