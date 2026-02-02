// src/utils/db.ts
import initSqlJs from "sql.js"
import fs from "fs"
import path from "path"

const dbDir = path.resolve(process.cwd(), "data")
const dbPath = path.join(dbDir, "news.db")

let dbInstance: any = null
let SQL: any = null

/**
 * 初始化并获取数据库实例
 */
async function getDb() {
  if (dbInstance) return dbInstance

  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true })
  }

  // 加载 Wasm 引擎
  if (!SQL) {
    SQL = await initSqlJs()
  }

  // 如果文件存在则读取，否则创建新库
  if (fs.existsSync(dbPath)) {
    const fileBuffer = fs.readFileSync(dbPath)
    dbInstance = new SQL.Database(fileBuffer)
  } else {
    dbInstance = new SQL.Database()
  }

  // 初始化表结构
  dbInstance.run(`
    CREATE TABLE IF NOT EXISTS news_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT UNIQUE,
      title TEXT,
      source_id TEXT,
      publish_date TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      status INTEGER DEFAULT 0
    )
  `)

  return dbInstance
}

/**
 * 将内存中的数据持久化到硬盘文件
 */
function persist(db: any) {
  const data = db.export()
  const buffer = Buffer.from(data)
  fs.writeFileSync(dbPath, buffer)
}

/**
 * 批量保存抓取到的新闻条目
 */
export async function saveNewsItems(
  items: Array<{ title: string; link: string; source: string; date?: Date }>,
) {
  const db = await getDb()

  const stmt = db.prepare(`
    INSERT OR IGNORE INTO news_items (url, title, source_id, publish_date) 
    VALUES (?, ?, ?, ?)
  `)

  for (const it of items) {
    try {
      stmt.run([
        it.link,
        it.title,
        it.source,
        it.date ? it.date.toISOString() : null,
      ])
    } catch (err) {
      console.error(`❌ DB Insert Error:`, err)
    }
  }

  stmt.free()
  // 🚨 关键：内存数据库必须手动执行导出到硬盘
  persist(db)
}

/**
 * 检查 URL 是否已经存在
 */
export async function isNewsExists(url: string): Promise<boolean> {
  const db = await getDb()
  const res = db.exec("SELECT id FROM news_items WHERE url = ?", [url])
  return res.length > 0 && res[0].values.length > 0
}
