// src/utils/db.ts
import initSqlJs from "sql.js"
import fs from "fs"
import path from "path"

const dbDir = path.resolve(process.cwd(), "data")
const dbPath = path.join(dbDir, "news.db")

let dbInstance: any = null
let SQL: any = null

/**
 * 统一 URL 归一化：
 * - 小写协议/主机
 * - 去掉尾部斜杠（根路径除外）
 * - 移除常见追踪参数（utm_*, fbclid 等）
 * - 失败时返回原始输入
 */
export function normalizeUrl(raw: string | undefined | null): string {
  if (!raw) return ""
  try {
    const u = new URL(raw)
    u.protocol = u.protocol.toLowerCase()
    u.hostname = u.hostname.toLowerCase()

    // 去除常见追踪参数
    const toDrop = [
      /^utm_/i,
      /^fbclid$/i,
      /^gclid$/i,
      /^mc_cid$/i,
      /^mc_eid$/i,
      /^oref$/i,
      /^cmpid$/i,
      /^_ga$/i,
    ]
    const params = u.searchParams
    for (const key of Array.from(params.keys())) {
      if (toDrop.some((r) => r.test(key))) params.delete(key)
    }
    // 重新写回 search
    u.search = params.toString()

    // 去掉尾部斜杠（但保留根路径）
    if (u.pathname.endsWith("/") && u.pathname !== "/") {
      u.pathname = u.pathname.replace(/\/+$/, "")
    }
    return u.toString()
  } catch (_e) {
    return raw
  }
}

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
      content TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      status INTEGER DEFAULT 0,
      cluster_key TEXT
    )
  `)

  // 确保向后兼容：老库可能没有 content 列，这里补齐
  const columns = dbInstance
    .exec(`PRAGMA table_info(news_items)`)
    ?.at(0)?.values?.map((row: any[]) => row[1]) // [cid, name, type...]
  if (columns && !columns.includes("content")) {
    dbInstance.run(`ALTER TABLE news_items ADD COLUMN content TEXT`)
  }
  return dbInstance
}

function persist(db: any) {
  const data = db.export()
  const buffer = Buffer.from(data)
  fs.writeFileSync(dbPath, buffer)
}

/**
 * 批量保存抓取到的新闻条目
 * 说明：所有新记录统一以未发布状态写入，发布状态由后续流程更新
 */
export async function saveNewsItems(
  items: Array<{
    title: string
    link: string
    source: string
    date?: Date
    content?: string
    cluster_key?: string
  }>,
) {
  const db = await getDb()

  const stmt = db.prepare(`
    INSERT OR IGNORE INTO news_items (url, title, source_id, publish_date, content, cluster_key, status) 
    VALUES (?, ?, ?, ?, ?, ?, 0)
  `)

  for (const it of items) {
    try {
      const ck = it.cluster_key || it.title
      const normalizedLink = normalizeUrl(it.link)
      stmt.run([
        normalizedLink,
        it.title,
        it.source,
        it.date ? it.date.toISOString() : null,
        it.content ?? null,
        ck,
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

  // 1) 归一化去重
  const normUrls = Array.from(
    new Set(urls.map((u) => normalizeUrl(u)).filter(Boolean)),
  )
  if (normUrls.length === 0) return

  // 2) 查找对应簇
  const placeholders = normUrls.map(() => "?").join(",")
  const clusterStmt = db.prepare(
    `SELECT DISTINCT cluster_key FROM news_items WHERE url IN (${placeholders})`,
  )
  const clusterKeys: string[] = []
  try {
    clusterStmt.bind(normUrls)
    while (clusterStmt.step()) {
      const row = clusterStmt.getAsObject() as any
      if (row.cluster_key) clusterKeys.push(row.cluster_key)
    }
  } catch (err) {
    console.error("❌ 查询 cluster_key 失败:", err)
  } finally {
    clusterStmt.free()
  }

  // 3) 按 URL 更新
  let affected = 0
  const updateByUrl = db.prepare(
    `UPDATE news_items SET status = ? WHERE url IN (${placeholders})`,
  )
  try {
    updateByUrl.run([status, ...normUrls])
    affected += db.getRowsModified?.() ?? 0
  } catch (err) {
    console.error("❌ 按 URL 更新状态失败:", err)
  } finally {
    updateByUrl.free()
  }

  // 4) 按簇更新（防止 URL 不同但同簇的记录漏标记）
  if (clusterKeys.length > 0) {
    const ckPlaceholders = clusterKeys.map(() => "?").join(",")
    const updateByCluster = db.prepare(
      `UPDATE news_items SET status = ? WHERE cluster_key IN (${ckPlaceholders})`,
    )
    try {
      updateByCluster.run([status, ...clusterKeys])
      affected += db.getRowsModified?.() ?? 0
    } catch (err) {
      console.error("❌ 按 cluster_key 更新状态失败:", err)
    } finally {
      updateByCluster.free()
    }
  }

  if (affected === 0) {
    console.warn(
      `⚠️ 状态更新未命中任何行，可能是链接未被归一化匹配或尚未入库。urls=${normUrls.join(",")}`,
    )
  }

  persist(db)
}

export async function getUnprocessedNews(): Promise<any[]> {
  const db = await getDb()
  const res = db.exec(
    "SELECT url as link, title, source_id as source, publish_date as date, content FROM news_items WHERE status = 0 ORDER BY publish_date DESC",
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
