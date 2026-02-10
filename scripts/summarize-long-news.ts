// scripts/summarize-long-news.ts
/* eslint-disable no-console */
import fs from "fs"
import path from "path"
import minimist from "minimist"
import "dotenv/config"
import { fetch as undiciFetch } from "undici"
import { getUnprocessedNews } from "../src/utils/db"

const fetchFn: typeof fetch =
  typeof globalThis.fetch === "function"
    ? globalThis.fetch.bind(globalThis)
    : (undiciFetch as any)

const argv = minimist(process.argv.slice(2), {
  boolean: ["skipSnapshot"],
  string: ["output", "model", "apiBase", "input", "maxTokens"],
  default: {
    output: "out/long-post.txt",
    model: "gpt-5.2",
    maxTokens: "8000",
    skipSnapshot: false,
  },
})

const model = String(argv.model || "gpt-5.2")

const maxTokensRaw = argv.maxTokens
const maxTokensParsed = Number.parseInt(String(maxTokensRaw), 10)
const maxTokens =
  Number.isFinite(maxTokensParsed) && maxTokensParsed > 0
    ? Math.min(maxTokensParsed, 12000) // 这里可以设置上限
    : 8000
console.log(`🧾 maxTokens=${maxTokens} (raw=${String(maxTokensRaw)})`)

const apiKey = process.env.OPENAI_API_KEY
const apiBase =
  (argv.apiBase || process.env.OPENAI_BASE || "").replace(/\/$/, "") ||
  "https://api.openai.com"

if (!apiKey) {
  console.error("❌ 缺少 OPENAI_API_KEY 环境变量")
  process.exit(1)
}

const outputPath = path.resolve(argv.output)

/**
 * [增强] 支持双模式加载数据
 * 1. 优先检查是否提供了 --input (测试模式)
 * 2. 如果没有，则从数据库读取 (生产模式)
 */
async function loadNewsData() {
  const inputPath = argv.input

  // 本地工具：判断一个对象是否“像新闻条目”
  function isNewsItem(x: any): boolean {
    if (!x || typeof x !== "object") return false

    const title = typeof x.title === "string" ? x.title.trim() : ""

    const link =
      typeof x.link === "string"
        ? x.link.trim()
        : typeof x.url === "string"
        ? x.url.trim()
        : typeof x.href === "string"
        ? x.href.trim()
        : ""

    const content =
      typeof x.content === "string"
        ? x.content.trim()
        : typeof x.summary === "string"
        ? x.summary.trim()
        : ""

    const source =
      typeof x.source === "string"
        ? x.source.trim()
        : typeof x.publisher === "string"
        ? x.publisher.trim()
        : typeof x.site === "string"
        ? x.site.trim()
        : ""

    const dateRaw =
      x.date ?? x.publishedAt ?? x.published_at ?? x.published ?? x.time

    const hasTitle = title.length > 0
    const hasLink = link.length > 0
    const hasContent = content.length > 0
    const hasSource = source.length > 0
    const hasDate =
      typeof dateRaw === "string" ||
      typeof dateRaw === "number" ||
      dateRaw instanceof Date

    // 判定尽量稳：至少要有 title/link/content 之一，并且最好带 source/date 任意一个
    const coreOk = hasTitle || hasLink || hasContent
    const metaOk = hasSource || hasDate

    return coreOk && metaOk
  }

  // 代表条目选择：同簇只保留一条，优先级（官方/机构 > 主流媒体 > 本地/其他），同级取最新时间
  function pickClusterRepresentatives(items: any[]): any[] {
    const groups = new Map<string, any[]>()
    const toKey = (it: any) =>
      (typeof it.cluster_key === "string" && it.cluster_key.trim()) ||
      (typeof it.title === "string" && it.title.trim()) ||
      (typeof it.link === "string" && it.link.trim()) ||
      ""

    for (const it of items) {
      const k = toKey(it)
      if (!k) continue
      if (!groups.has(k)) groups.set(k, [])
      groups.get(k)!.push(it)
    }

    const score = (source: string | undefined): number => {
      const s = (source || "").toLowerCase()
      if (
        /rcmp|police|gov|gouv|gnb|nbpower|health|transport|justice|court|city|town|village|municipal|department|ministry|authority|hospital|school district|university/.test(
          s,
        )
      )
        return 3
      if (
        /cbc|ctv|global|reuters|ap|canadian press|telegraph|saltwire|globalnews|national|bbc/.test(
          s,
        )
      )
        return 2
      return 1
    }

    const getTime = (it: any): number => {
      const dRaw =
        it.date ?? it.publish_date ?? it.publishDate ?? it.time ?? it.dateISO
      const d = dRaw ? new Date(dRaw) : null
      return d instanceof Date && !Number.isNaN(d.getTime())
        ? d.getTime()
        : 0
    }

    const representatives: any[] = []
    for (const [, list] of groups) {
      const best = list.slice().sort((a, b) => {
        const sa = score(a.source)
        const sb = score(b.source)
        if (sa !== sb) return sb - sa
        const ta = getTime(a)
        const tb = getTime(b)
        if (ta !== tb) return tb - ta
        const la = (a.title || "").length
        const lb = (b.title || "").length
        return la - lb
      })[0]
      representatives.push(best)
    }
    return representatives
  }

  // 本地工具：尽可能从任意 JSON 结构中提取新闻条目数组
  function extractNewsItems(input: any): any[] {
    // 1) 输入本身是数组
    if (Array.isArray(input)) {
      // 1.1) 分组数组（允许混杂）：数组里只要“有一些”元素形如 { items: [...] } 就提取
      const groupedCandidates = input.filter(
        (x) =>
          x &&
          typeof x === "object" &&
          "items" in x &&
          Array.isArray((x as any).items),
      )

      if (groupedCandidates.length > 0) {
        const groupedItems = groupedCandidates.flatMap((g: any) =>
          Array.isArray(g.items) ? g.items : [],
        )

        // groupedItems 里可能还有一层嵌套容器，继续递归“捞”
        const flattened = groupedItems.flatMap((v: any) =>
          isNewsItem(v) ? [v] : extractNewsItems(v),
        )

        // 同一个数组里可能还混着直接新闻条目/其他容器，也继续捞一遍
        const alsoFromMixedArray = input.flatMap((v: any) =>
          isNewsItem(v) ? [v] : extractNewsItems(v),
        )

        const merged = [...flattened, ...alsoFromMixedArray]
        return merged.filter(isNewsItem)
      }

      // 1.2) 直接是新闻条目数组
      const directNews = input.filter(isNewsItem)
      if (directNews.length > 0) {
        return directNews
      }

      // 1.3) 数组里可能还有嵌套容器：逐个递归提取
      const nested = input.flatMap((v: any) => extractNewsItems(v))
      return nested.filter(isNewsItem)
    }

    // 2) 输入是对象（容器）
    if (input && typeof input === "object") {
      const obj = input as Record<string, any>

      // 2.1) 优先尝试常见字段
      const preferredKeys = [
        "items",
        "news",
        "data",
        "results",
        "groups",
        "articles",
      ]
      for (const k of preferredKeys) {
        if (k in obj) {
          const found = extractNewsItems(obj[k])
          if (found.length > 0) {
            return found.filter(isNewsItem)
          }
        }
      }

      // 2.2) 如果对象本身就是新闻条目
      if (isNewsItem(obj)) {
        return [obj]
      }

      // 2.3) 兜底：遍历所有 value 继续递归
      const allValues = Object.values(obj)
      const found = allValues.flatMap((v: any) => extractNewsItems(v))
      return found.filter(isNewsItem)
    }

    // 3) 其他原始类型
    return []
  }

  if (inputPath && fs.existsSync(inputPath)) {
    console.log(`🧪 [TESTING] 正在从测试文件加载预览数据: ${inputPath}`)
    try {
      const rawData = fs.readFileSync(inputPath, "utf-8")
      const items = JSON.parse(rawData)
      const finalItems = extractNewsItems(items)

      console.log(`🧾 maxTokens=${maxTokens} (raw=${String(maxTokensRaw)})`)

      if (finalItems.length === 0) {
        console.warn("⚠️ 测试文件中没有新闻数据。")
        process.exit(0)
      }

      const reps = pickClusterRepresentatives(finalItems)
      console.log(
        `统计：从测试文件提取了 ${finalItems.length} 条新闻；代表条目去重后 ${reps.length} 条。`,
      )
      return reps
    } catch (err) {
      console.error("❌ 解析测试文件失败:", err)
      process.exit(1)
    }
  }

  console.log(`🤖 model=${model} (raw=${String(argv.model)})`)
  // 生产模式：读取数据库
  console.log("读取数据库中未处理的新闻...")
  const dbItems = await getUnprocessedNews()

  if (dbItems.length === 0) {
    console.warn("⚠️ 数据库中没有未处理的新闻条目。")
    process.exit(0)
  }

  const reps = pickClusterRepresentatives(dbItems)

  console.log(
    `统计：从数据库提取了 ${dbItems.length} 条新闻；代表条目去重后 ${reps.length} 条。`,
  )
  return reps
}

// 核心修复：保持 callOpenAI 逻辑不变
async function callOpenAI(prompt: string): Promise<string> {
  const maxAttempts = 3
  let lastErr: Error | undefined

  for (let i = 1; i <= maxAttempts; i++) {
    try {
      const res = await fetchFn(`${apiBase}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          // model: argv.model,
          // gpt-5.x 系列需要用 max_completion_tokens；旧模型仍用 max_tokens。
          ...(model.startsWith("gpt-5")
            ? { max_completion_tokens: maxTokens }
            : { max_tokens: maxTokens }),
          temperature: 0.2,
          top_p: 0.9,
          presence_penalty: 0,
          frequency_penalty: 0,
          messages: [
            {
              role: "system",
              content:
                "你是一位硬新闻编辑与事实整理员，只做忠实原文的事实陈述摘要，禁止评论与脑补。",
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
      const choice = json.choices?.[0]
      const result = choice?.message?.content
      if (!result) {
        throw new Error(
          `OpenAI API 返回内容为空。raw=${JSON.stringify(json).slice(0, 800)}`,
        )
      }

      return result as string
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err))
      if (i < maxAttempts) {
        await new Promise((r) => setTimeout(r, 2000 * i))
        continue
      }
    }
  }
  throw lastErr || new Error("Unknown error in callOpenAI")
}

function sanitizeModelOutput(raw: string): string {
  const text = raw.replace(/^\uFEFF/, "").trim()
  if (!text) return ""

  // ====== Strict ======
  const strictBlockRe = /^\s*\[SECTION_START\][\s\S]*?^\s*---END_OF_ARTICLE---\s*$/gm
  const strictBlocks = text.match(strictBlockRe) ?? []

  const strictValid = strictBlocks
    .map((b) => b.trim())
    .filter((b) => {
      return (
        b.includes("[TITLE_START]") &&
        b.includes("[TITLE_END]") &&
        b.includes("[BODY_START]") &&
        b.includes("[BODY_END]") &&
        b.includes("原文链接：")
      )
    })

  // ====== Loose ======
  const looseBlocks: string[] = []
  const START = "[SECTION_START]"
  const END = "---END_OF_ARTICLE---"

  let cursor = 0
  while (cursor < text.length) {
    const s = text.indexOf(START, cursor)
    if (s === -1) break

    const e = text.indexOf(END, s)
    let block = ""
    let nextCursor = text.length

    if (e === -1) {
      // 🚨 抢救逻辑：找不到 END 标记时的处理
      const nextStart = text.indexOf(START, s + START.length)

      if (nextStart !== -1) {
        // Case A: 后面还有 START，说明当前段落漏了 END，取到下一个 START 之前
        block = text.slice(s, nextStart)
        nextCursor = nextStart
      } else {
        // Case B: 后面没有 START 了，说明这是最后一段，直接取到文本末尾
        block = text.slice(s)
        nextCursor = text.length

        // 最后一段缺 END -> 补 END，保证结构完整
        if (!block.includes(END)) {
          block = block.trimEnd() + "\n" + END
        }
      }
    } else {
      // 正常逻辑：找到了 END
      // END 后同一行残留吃完（包含换行）
      const afterEnd = text.slice(e + END.length)
      const nlIdx = afterEnd.search(/\r?\n/)

      if (nlIdx >= 0) {
        const nlLen =
          afterEnd[nlIdx] === "\r" && afterEnd[nlIdx + 1] === "\n" ? 2 : 1
        block = text.slice(s, e + END.length + nlIdx + nlLen)
        nextCursor = e + END.length + nlIdx + nlLen
      } else {
        block = text.slice(s, e + END.length)
        nextCursor = e + END.length
      }
    }

    // ✅ 只在这里更新 cursor（修复：不要提前跳到末尾）
    cursor = nextCursor

    // 校验逻辑（原样保留）
    const looksOk =
      block.includes("[TITLE_START]") &&
      block.includes("[TITLE_END]") &&
      block.includes("[BODY_START]") &&
      block.includes("[BODY_END]") &&
      block.includes("原文链接：")

    if (!looksOk) continue

    // 第一行修补逻辑（原样保留）
    const lines = block.split(/\r?\n/)
    if (lines.length > 0) {
      const first = lines[0]
      if (first.includes(START) && !first.includes("[SECTION_END]")) {
        lines[0] = first.trimEnd() + " [SECTION_END]"
        block = lines.join("\n")
      }
    }

    looseBlocks.push(block.trim())
  }

  // ====== Merge with stable key ======
  // 关键修复点：不再用 block 全文去重；用“链接优先”的稳定 key
  function extractStableKey(block: string): string {
    const m = block.match(/原文链接：\s*(\S+)/)
    const link = m?.[1]?.trim()
    if (link && link !== "未提供") return `link:${link}`

    // 没链接：用标题 + body 前缀做兜底 key（更稳定）
    const t = block.match(/\[TITLE_START\][\s\S]*?\[TITLE_END\]/)?.[0] ?? ""
    const b = block.match(/\[BODY_START\][\s\S]*?\[BODY_END\]/)?.[0] ?? ""
    const titleKey = t.replace(/\s+/g, " ").slice(0, 200)
    const bodyKey = b.replace(/\s+/g, " ").slice(0, 200)
    const fallback = `${titleKey}__${bodyKey}`.trim()
    return fallback ? `tb:${fallback}` : `raw:${block.slice(0, 200)}`
  }

  const merged: string[] = []
  const seen = new Set<string>()

  // 先 loose 再 strict：优先保留“修补后更完整”的版本
  for (const b of looseBlocks) {
    const k = extractStableKey(b)
    if (!seen.has(k)) {
      seen.add(k)
      merged.push(b)
    }
  }

  for (const b of strictValid) {
    const k = extractStableKey(b)
    if (!seen.has(k)) {
      seen.add(k)
      merged.push(b)
    }
  }

  return merged.length > 0 ? merged.join("\n\n") + "\n" : ""
}

/** 构造提示词，给定任意子集 */
function buildPrompt(subset: any[]): string {
  return `
# Role
你是一位专业的“硬新闻编辑”与“事实整理员”，只做忠实原文的事实陈述摘要，禁止评论与脑补。任务：将输入 JSON 新闻列表整理为可直接发布到微信公众号的新闻快讯。

# Global Rules（最高优先级）
- 忠实原文：只允许使用 JSON 中明确提供的细节（title/link/source/date/content）。
- 禁止脑补：严禁常识补充、推测动机、推导后果。
- 禁止评价：严禁评论、建议、科普、风险提示、未来展望、情绪化表达。
- 信息不足时：宁可短、宁可贴近原文复述/直译，也绝不扩写补背景。
- 禁止重复：同一事实最多出现一次（除非用于并列呈现“不同来源表述不一”的冲突）。

# 🚨 Step 0：地理过滤（务实：核心在 NB 或明确涉及 NB 即保留）
目标：输出中不得出现与 New Brunswick 无关的新闻。

判定规则（必须按顺序执行）：
判定顺序：
1) 明确保留：title/content 明确出现 New Brunswick，或出现 NB 城市/地区（Saint John / Moncton / Fredericton / Dieppe / Woodstock / Riverview / Quispamsis / Rothesay 等）且这些词用于描述事件地点/机构归属。
2) 明确剔除：title/content 明确指向 NB 省外地点（如 Nova Scotia / Ontario / Quebec / Manitoba / North Carolina / Maine / New England 等）且未明确提到 NB 参与/受影响/相关机构。
3) 地点不明：如果 title/content 不能判断事件是否发生在 NB，也不能判断是否“明确涉及 NB”，则默认保留。
输出中不得出现任何被剔除新闻的提示或列表。

注意：
- 仅做“是否涉及 NB”的筛选，不得补充地理背景解释。
- 被剔除的新闻不输出任何提示、不输出清单、不解释原因。

# 🚨 Step 1：严格查重与合并（Dedup）
1. 事件识别：若多条记录描述同一真实事件，必须合并为一条。
2. 合并原则：仅整合任一原文明示的事实；禁止补齐缺失信息。
3. 时间窗口：默认以 7 天为“相近”范围；若为同一事件后续进展（同一当事人/机构/地点/案号/明确指向同一事件），允许跨越 7 天合并，并在正文按时间线串联。
4. 冲突处理：若事实冲突——
   - 有官方来源则以官方为准；
   - 无官方则客观并列两种说法，并使用“不同来源表述不一”，禁止裁决真伪。
5. 链接保留：合并后只保留一个链接，优先级为：官方通告 > 主流媒体 > 本地媒体 > 其他。
   - 若最高优先级链接为空/缺失则顺延；
   - 若均为空则写“原文链接：未提供”。

# 📋 Step 2：板块归类（只输出板块标签，不解释原因）
🛡️【治安防范】、🏗️【市政规划】、🍎【社区教育】、⚡【生活服务】、❄️【天气景观】、📌【综合资讯】
无法明确归入前五类时，统一归入📌【综合资讯】。

# 🌐 Step 3：翻译与保留原文规
优先级：标题规则 E > 固定地名替换 C > 机构/术语规则 B > 设施规则 F > 人名地名规则 A > 总开关 G（仅对正文生效）

A) 地名与人名处理（硬规则）
  - 固定译名（见 C）在标题与正文中必须使用中文译名，且不附英文。
  - 除固定译名外：所有人名、地名、街道名一律保留英文原文，不提供中文对照翻译。
  - 国家名（包含国家名缩写）例外（仅正文）：正文中出现国家名或其缩写时，一律翻译成中文国家名；标题仍按 E 执行。
  - 设施/场所名称不在 A 处理范围，统一按 F 执行。
 

B) 翻译并可附英文原文一次（适用于“非人名/非地名”的专有名词，【硬规则】）
以下类型允许翻译成中文，并在首次出现时用括号附英文原文一次；后文只用中文：
  - 政府机构/部门/执法机构/司法机构/公共服务单位：例如
    “Saint John Police Force”→“圣约翰警察局（Saint John Police Force）”
    “New Brunswick Justice and Public Safety Coroner Services”→“新不伦瑞克司法与公共安全验尸官服务（New Brunswick Justice and Public Safety Coroner Services）”
  - 职务头衔/机构内角色：例如 “President and CEO”→“总裁兼首席执行官（President and CEO）”
  - 医疗术语/分诊等级/专业称谓：例如 “triage level 4 and 5”→“分诊等级4和5（level 4 and 5）”
  - 法律/刑事指控/法庭程序/法律文件名：必须译成中文，并在首次出现时附英文原文一次：例如
    “manslaughter”→“过失杀人（manslaughter）”
    “probation order”→“缓刑令（probation order）”
    “bail hearing”→“保释听证（bail hearing）”
    “remanded into custody”→“被还押（remanded into custody）”
  - 组织/团体/机构名称（专名）中文化规则（硬规则）
    a.	正文中出现组织/机构专名时：优先使用中文通用译名，并在首次出现时追加英文原名括注一次，格式固定为：中文通用译名（英文原名）,后文只用中文通用译名，不再重复英文。
    b. “中文通用译名”要求：“若该机构有众所周知的中文名（如‘司法部’），优先使用；若无公认译名，允许写一个直观功能译法，并保留英文原名，格式固定为：中文通用译名（英文原名）。”
    c. 示例：
        •	“Saint John Police Force” → “圣约翰警察局（Saint John Police Force）”
        •	“City of Saint John” → “圣约翰市政府（City of Saint John）”
        •	“Department of Justice” → “司法部（Department of Justice）”
        •	“PRUDE Inc.” → “PRUDE Inc.” 
          （若无法给出可靠中文通用译名，则按 B-e 保留英文原名裸写。）
    d. 何时判定为“组织/机构专名”（避免把普通名词当组织名）：满足任一即可
        (1).	包含明显机构后缀/关键词：Police / City / Department / Ministry / Authority / Court / Hospital / School / University / Association / Society / Network / Services / Inc. / Ltd.
        (2).	多个英文单词首字母大写构成专名（不含句首普通词）
    e. 若无法给出可靠的中文通用译名：允许在正文中直接保留该组织/机构的英文原名（不加中文、不加括注）；仅限组织/机构专名本身，不得扩展为普通名词或解释性英文；仍不得额外添加英文同义普通词。

C) 仅限固定城市译名替换（保留原规则）
  - New Brunswick→新不伦瑞克；Moncton→蒙克顿；Fredericton→弗莱；Saint John→圣约翰；Dieppe→迪耶普。这些地名和其他地名不一样，默认翻译成中文，且后面不提供英文。
  说明：
  - 上述替换仅对“作为地名时”生效。
  - 例如 “City of Saint John” 可写为 “圣约翰市政府（City of Saint John）” 。

D) 术语一致性
  - 组织/机构名称的中文通用译名一经确定，全篇保持一致；不得在“中文通用译名 / 英文原名 / 中文泛称（如警方）”之间来回切换。

E) 标题规则：
  -	生成标题前，原标题中出现 New Brunswick / Saint John / Moncton / Fredericton / Dieppe 时，必须使用固定中文译名（新不伦瑞克/圣约翰/蒙克顿/弗莱/迪耶普）；
  -	标题中其他地名一律保留英文原文，不做翻译。
  -	标题优先使用纯中文，但可以有纯英文的人名地名，不得出现中文+括号英文；

F) 设施/场所名称规则（硬规则）

  -	设施类型（通用名词）：只写中文，不加英文。
    •	适用：shelter / hospital / city hall / courthouse / arena / community centre / airport / harbour / library / school / station / office 等作为“类型”出现时。
    •	示例：
      •	men’s shelter → 男子收容所（不加英文）
      •	a city hall / the city hall → 市政厅（不加英文）

  -	设施专名特指某一个具体地点/机构的名字, 判定规则（满足任一即视为专名）：
    a) 英文中包含专名成分：人名/姓氏、品牌、城市/区域名、独特词组（如 Smith / Wingate / Harbour Station / Saint John / Regional）。
    b) 以官方写法出现、可被当作“招牌名/机构名”的整体短语（通常为首字母大写的词组）。
    c) 与唯一定位信息并列出现（如具体地址、路名门牌、明确“在 X 处”且 X 是唯一地点）。
      •	示例：
      •	Smith Shelter → 史密斯收容所（Smith Shelter）
      •	Wingate hotel → 温盖特酒店（Wingate hotel）
      •	City Hall（当明确指“某城市的市政厅大楼/机构”，例如与 Saint John/Dieppe 等并列）→ 市政厅（City Hall）
      •	Saint John Regional Hospital → 圣约翰地区医院（Saint John Regional Hospital）

  - 设施专名首次出现用“中文（英文专名）”，后文只用中文。

  -	若某名称同时满足“机构/组织专名判定（B-d）”与“设施判定（F）”，则优先按 B 作为机构处理；仅当其以纯类型词出现（如 a hospital / the courthouse）时，按 F 作为设施类型处理。

  - 禁止“为了显得准确而补英文”：只要是设施类型/通用名词，即便原文是英文，也必须只写中文，不得括注英文。

G) 总开关，硬规则
  - 本条规则仅对正文（BODY_START…BODY_END）生效；标题只按 E 执行 
	-	正文中出现英文只允许来自以下五类“合法结构”：
   1)	引号内英文原话（Step 5-7a）：英文后必须紧跟中文翻译（括号内）。
   2)	专名括注结构：
      -	组织/机构专名：中文通用译名（英文原名）（Step 3B-机构中文化规则）
      -	设施专名：中文（英文专名）（Step 3F-设施专名）
      （以上括注英文不再重复加“中文释义”，因为中文主体已完成释义）
   3) 专业术语括注（Step 5-7b）：仅限法律/医疗/程序等专业术语，英文后紧跟中文释义（括号内），同一术语全篇只释义一次。
   4) 符合规则 A 的人名/地名/街道名：允许以英文原文直接出现（不加中文释义）；必须满足‘原文明确指向具体人/具体地点/具体街道’或与地址/路名/门牌等唯一定位信息并列出现；不得因首字母大写就将普通词归入本类。
	 5) 组织/机构专名无法给出可靠中文通用译名时：按 B-e 执行，可保留英文原名裸写（仅限名称本身）。
   -	除上述五类结构外：正文中禁止出现任何英文（包括普通名词、通用短语、解释性英文、同义英文、英文化改写）。

# ✍️ Step 4：内部两阶段写作（必须执行，但不得出现在输出中）
对每条新闻，先在内部提取“可核对事实清单”（时间/地点/人物/机构/动作/数字/指控/官方进展/原话），再据此写正文。
最终输出中不得出现事实清单或任何“步骤说明”。

# ✍️ Step 5：正文写作要求（尽量满足 400–600 字）
  - 目标字数：400–600 字（尽量满足）。
  - 必须优先写入的事实要素（仅当原文明示时）：
    1) 时间：发生/公布时间、时间段、截止日期、出庭/活动日期等；
    2) 地点：城市/街道/设施/机构；
    3) 主体：政府部门、警方、医院、学校、组织、当事人；
    4) 动作：发布/通告/起诉/逮捕/送医/调查/资金拨付/开放提名等；
    5) 数字：金额、人数、比例、重量、时间、检查次数、违规数量等；
    6) 进展：调查状态、法庭进程、下一步安排（仅限原文明示）；
    7) 英文释义规则（硬规则，英文是否允许出现，以 Step 3G 为准；本条仅规定出现后的中文释义方式）：	
      a. 引号内英文原话：保留英文，并在其后紧跟中文翻译（括号内）。
      b. 非引号英文（仅限非人名/非地名）：
          •	若英文出现在“中文通用译名（英文原名）”结构中：不再对该英文重复添加中文释义（因为中文通用译名已等价释义）。
          •	若英文是“专业术语括注”（法律/医疗/程序等）：则在英文后紧跟中文释义（括号内），且同一术语全篇只释义一次。
          •	若英文出现在“中文（设施英文专名）”结构中：不再对该英文重复添加中文释义。
      c.  人名与地名（含街道名）：不添加中文释义；固定译名按 C 执行。设施/场所名称按 F 执行。
      d. 同一篇内：同一“专业术语括注”（法律/医疗/程序等）只做一次中文释义；机构/设施的括注英文不做额外释义；引号内原话每次出现都必须翻译。

  - 组织方式（用于拉齐字数但不增加事实）：
    A) 按时间线重排：先“核心事实”，再“细节清单”，再“进展/下一时间点/联系方式”（如有）。
    B) 列表信息必须完整列出（街道清单、指标清单、阶段性数字），不得用概括替代。
    C) 多组数字/指标必须逐项写出，不得写“多项指标”等模糊表述。
  - 低信息模式（允许短于 400 字）：
    仅当原文缺少足够“可枚举细节”（地点细化/数字/进展/引述/清单等）时允许短于 400 字；且必须最大化使用原文已有细节，不得扩写背景。

# ❌ 绝对禁止项（除非原文明示，否则不得出现）
  - 禁止句式：从…角度看、这反映了、这意味着、被视为、值得关注、值得警惕、提醒市民、建议大家、应当需要、有望预计或将、可能导致、示范效应、路线图、治理议题。
  - 禁止内容：意义分析、社会影响、温馨提醒、安全建议、应对措施、风险提示、价值判断、心理推测、未来预测。
  - 禁止形容词：严重的、令人痛心的、积极的、异常的、复杂的、敏感的（除非原文引用或原话转述）。

# ✅ 最终输出格式（程序解析关键）
每条新闻必须严格输出如下格式，不得有任何多余文字。输出必须以 [SECTION_START] 开始。

[SECTION_START] 🧩板块：{板块标签} [SECTION_END]
[TITLE_START] 【中文标题，含核心动词，25字以内】 [TITLE_END]
[BODY_START]
正文（硬新闻事实陈述；段落之间空一行；不得写空话开场白）
[BODY_END]
原文链接：URL
---END_OF_ARTICLE---

# 🚨 结构硬约束（必须遵守）
- 严禁输出“孤立板块头”。任何出现 [SECTION_START] 必须立刻输出完整文章块：
  [SECTION_START]... [SECTION_END]
  [TITLE_START]... [TITLE_END]
  [BODY_START]... [BODY_END]
  原文链接：...
  ---END_OF_ARTICLE---
- 严禁在文章块之外输出任何 [SECTION_START] 或 [SECTION_END] 字样。
- 如果某条新闻无法生成正文，则整条跳过，不得留下板块头残片。

JSON 数据：
${JSON.stringify(subset, null, 2)}
`
}

function isContextError(err: unknown): boolean {
  const msg = (err as Error)?.message || ""
  const m = msg.toLowerCase()

  // 明确的上下文/长度类报错
  if (
    m.includes("context_length_exceeded") ||
    m.includes("maximum context length") ||
    m.includes("this model's maximum context length") ||
    m.includes("exceeds the maximum") ||
    m.includes("too many tokens") ||
    m.includes("maximum prompt tokens") ||
    m.includes("context window") ||
    (m.includes("requested") && m.includes("tokens") && m.includes("maximum"))
  ) {
    return true
  }

  // invalid_request_error：只有在同时出现“明显上下文长度线索”时才算
  if (m.includes("invalid_request_error")) {
    const looksLikeContext =
      m.includes("context") ||
      m.includes("context_length") ||
      m.includes("maximum context") ||
      m.includes("too many tokens") ||
      (m.includes("exceeds") && m.includes("maximum") && m.includes("tokens"))

    return looksLikeContext
  }

  return false
}

/**
 * 分片生成：若触发上下文超长，自动把输入拆半递归重试。
 * 每个成功批次都会 append 到 outputPath，并保留顺序。
 */
async function generateInParts(items: any[], partNo: number): Promise<void> {
  if (items.length === 0) return
  try {
    const prompt = buildPrompt(items)
    const content = await callOpenAI(prompt)
    const cleaned = sanitizeModelOutput(content)

    // 如果清洗后为空：落盘 raw 方便你定位模型实际返回内容
    if (!cleaned.trim()) {
      const debugPath = outputPath.replace(
        /\.txt$/,
        `.raw.part${partNo}.${Date.now()}.txt`,
      )
      try {
        fs.writeFileSync(debugPath, content ?? "", "utf8")
        console.warn(
          `⚠️ 第 ${partNo} 部分输出未包含任何可解析文章块，已写入 debug: ${debugPath}`,
        )
      } catch (e) {
        console.warn(
          `⚠️ 第 ${partNo} 部分输出为空且 debug 写入失败：${String(
            (e as any)?.message ?? e,
          )}`,
        )
      }
      return
    }

    fs.appendFileSync(outputPath, cleaned, "utf8")
    fs.appendFileSync(outputPath, "\n", "utf8")

    console.log(`✅ 已生成第 ${partNo} 部分（输入 ${items.length} 条）`)
  } catch (err) {
    if (isContextError(err) && items.length > 1) {
      const mid = Math.ceil(items.length / 2)
      const left = items.slice(0, mid)
      const right = items.slice(mid)
      console.warn(
        `⚠️ 第 ${partNo} 部分触发上下文超长，拆分为 ${left.length} + ${right.length} 条再试...`,
      )
      await generateInParts(left, partNo)
      await generateInParts(right, partNo + 1)
    } else {
      throw err
    }
  }
}

async function main() {
  const groups = await loadNewsData()

  // 确保输出目录存在并清空旧文件（单跑和 pipeline 都安全）
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, "", "utf8")

  // 将本次用于生成的代表条目写入快照，供短篇直接复用，避免重复抓取/生成
  if (!argv.skipSnapshot) {
    try {
      const snapshotPath = path.resolve("out/latest-long-source.json")
      fs.mkdirSync(path.dirname(snapshotPath), { recursive: true })
      fs.writeFileSync(snapshotPath, JSON.stringify(groups, null, 2), "utf8")
      console.log(`💾 已保存长篇源数据快照: ${snapshotPath}`)
    } catch (e) {
      console.warn(
        `⚠️ 无法写入长篇源数据快照: ${
          (e as any)?.message ?? String(e)
        }（不影响生成）`,
      )
    }
  }

  console.log("📤 调用 OpenAI 生成长篇深度文案（可自动分片）...")
  await generateInParts(groups, 1)

  console.log(`✅ 长文案已生成: ${outputPath}`)
}

main().catch((err) => {
  console.error("❌ 生成失败:", err.message)
  process.exit(1)
})
