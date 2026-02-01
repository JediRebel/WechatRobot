// src/scrapers/genericScraper.ts
/* eslint-disable no-console */

// ===== deps =====
import axios from 'axios';
import pLimit from 'p-limit';

// cheerio
import * as cheerio from 'cheerio';
import type { Cheerio } from 'cheerio';
import type { AnyNode, Element } from 'domhandler';

// dayjs + tz
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
dayjs.extend(utc);
dayjs.extend(timezone);

// 统一从 utils/types 引类型
import type {
  HtmlScraperConfig,
  ScrapeOptions,
  RawNewsRow as RawRow,
} from '../utils/types';

// ===== 仅在本文件使用的结构 =====
export interface FinalItem {
  title: string;
  link: string;
  date?: Date;
  source: string;
  content?: string; // ✅ 用于存储抓取到的正文全文
}

// ===== 工具 =====
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

function absUrl(link: string, base?: string): string {
  if (!link) return link;
  if (/^https?:\/\//i.test(link)) return link;
  if (link.startsWith('//')) return 'https:' + link;
  if (!base) return link;
  return new URL(link, base).toString();
}

function pickText($el: Cheerio<Element>): string {
  return ($el.text() || '').trim();
}
function pickAttr($el: Cheerio<Element>, attr: string): string {
  return ($el.attr(attr) || '').trim();
}

/** * ✅ 增强版：强力清洗标题 
 * 修改点：加入了对 \n \t 的强力清洗，以及 NB Power 的后缀去除
 */
function cleanTitleBySite(raw: string, sourceId: string): string {
  if (!raw) return '';

  // 1️⃣ [新增] 暴力清洗：把所有 换行(\n)、回车(\r)、制表符(\t) 统统变成空格
  // 这是解决 NB Power 标题里有大量空白和换行的关键
  let t = raw.replace(/[\r\n\t]+/g, ' ');
  
  // 2️⃣ 压缩空格：把 "NB Power    files" 变成 "NB Power files"
  t = t.replace(/\s+/g, ' ').trim();

  // 3️⃣ Quispamsis (保留原有逻辑)
  if (sourceId === 'quispamsis') {
    t = t.replace(/By Town of Quispamsis\s*$/i, '').trim();
  }

  // 4️⃣ [新增] NB Power 特殊处理
  // 此时 t 已经是单行文本了，格式类似于 "Title - 2026-01-23"
  if (sourceId === 'nb-power') {
    // 匹配 " - YYYY-MM-DD" 以及后面可能存在的任何字符，全部切掉
    t = t.replace(/\s*-\s*\d{4}-\d{2}-\d{2}[\s\S]*$/, '').trim();
  }

  return t;
}

/** * 从详情页尽量提取核心正文文本 
 * (完全保留了你原有的 CTV 和 Country 94 逻辑)
 */
function extractMainContent($: cheerio.CheerioAPI, config: HtmlScraperConfig): string {
  // 1️⃣ 【特种部队策略】优先检查 CTV/Fusion 架构的元数据
  const fusionScript = $('script#fusion-metadata').html();
  if (fusionScript) {
    try {
      const match = fusionScript.match(/Fusion\.globalContent\s*=\s*(\{.*?\});/);
      if (match && match[1]) {
        const json = JSON.parse(match[1]);
        if (json.content_elements && Array.isArray(json.content_elements)) {
          const textParts = json.content_elements
            .filter((el: any) => el.type === 'text' || el.type === 'raw_html')
            .map((el: any) => {
              const rawText = el.content || '';
              return rawText.replace(/<[^>]+>/g, '').trim();           
            });
          
          if (textParts.length > 0) {
            return textParts.join(' ');
          }
        }
      }
    } catch (e) {
      // JSON 解析失败则忽略，继续往下走
    }
  }

  // ==========================================
  // 下面是你原有的常规 HTML 抓取逻辑
  // ==========================================

  // 移除干扰元素
  $('script, style, nav, footer, header, aside, .sidebar, .menu, .ads, .nav, .alert, .ad, iframe, .c-related-stories, .pp-multiple-authors-boxes-wrapper').remove();

  let content = '';

  // 2️⃣ 优先使用配置文件里的 content 选择器
  if (config.selectors?.content) {
    const $els = $(config.selectors.content);
    if ($els.length > 0) {
      content = $els.map((_, el) => $(el).text().trim()).get().join(' ');
    }
  }

  // 3️⃣ 如果没配置或没抓到，尝试匹配常见的正文容器选择器
  if (!content) {
    const contentSelectors = [
      'article', 
      '.content', 
      '.post-content', 
      '.entry-content', 
      '.article-body',
      'main',
      '#main-content',
      '.field-item',
      '.node__content',
      '.body-text',
      '#content',          
      '.view-content',      
      '.b-article-body'
    ];

    for (const sel of contentSelectors) {
      const $container = $(sel);
      if ($container.length > 0) {
        const $ps = $container.find('p');
        if ($ps.length > 2) {
           content = $ps.map((_, el) => $(el).text().trim()).get().join(' ');
        } else {
           content = $container.text().trim();
        }
        
        if (content.length > 50) break; 
      }
    }
  }

  // 4️⃣ 兜底方案
  if (!content) {
    const paragraphs = $('p').map((_, el) => $(el).text().trim()).get();
    content = paragraphs.join(' ').trim();
  }

  // 🧹 Country 94 专用清理 (保留原有逻辑)
  if (config.id === 'country94') {
    const noiseTriggers = [
      'Current weather conditions',
      'View all posts',
      'Do you have a news tip',
      'Newsletter Signup'
    ];

    for (const trigger of noiseTriggers) {
      const regex = new RegExp(`${trigger}[\\s\\S]*$`, 'i');
      content = content.replace(regex, '');
    }
  }
  
  // 统一压缩空白符并返回
  return content.replace(/\s+/g, ' ').trim();
}

/** 按 link 去重，避免同一篇文章重复出现 */
function dedupeByLink(rows: RawRow[]): RawRow[] {
  const seen = new Set<string>();
  return rows.filter((r) => {
    const key = (r.link || '').toLowerCase();
    if (!key) return false; // 没链接的直接丢弃
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** * ✅ 增强版：宽松解析英文日期 
 * 修改点：增加了从长文本中提取 YYYY-MM-DD 的能力，解决 NB Power 日期在标题里的问题
 */
function parseDateLoose(input?: string): Date | undefined {
  if (!input) return undefined;
  
  const s = input.trim();

  // 🆕 [新增] 优先尝试提取 YYYY-MM-DD 格式
  // 即使字符串是 "Title Text - 2026-01-23 some other text"，这行也能把日期提取出来
  const isoMatch = s.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (isoMatch) {
    const d = dayjs(isoMatch[1]);
    if (d.isValid()) return d.toDate();
  }
  
  // 下面保持你原有的逻辑不变
  // 1. 移除常见前缀
  let clean = s
    .replace(/^(posted|published)(?:\s+on)?\s*[:]?\s*/i, '') 
    .replace(/\s+at\s+/i, ' ')
    .replace('|', ' ')
    .replace(/(\d+)(st|nd|rd|th)/gi, '$1')
    .replace(/,+/g, ',')
    .trim();

  // 2. 移除常见干扰后缀
  const inIndex = clean.indexOf(' in ');
  if (inIndex > 0) {
    const candidate = clean.substring(0, inIndex).trim();
    const d = dayjs(candidate);
    if (d.isValid()) return d.toDate();
  }

  // 3. 尝试直接解析
  const d = dayjs(clean);
  if (d.isValid()) return d.toDate();

  // 4. 兜底
  const native = new Date(clean);
  return Number.isNaN(native.getTime()) ? undefined : native;
}

/** 从详情页尽量找日期 */
function extractDetailDate($: cheerio.CheerioAPI): Date | undefined {
  const meta =
    $('meta[property="article:published_time"]').attr('content') ||
    $('meta[name="date"]').attr('content') ||
    $('meta[name="pubdate"]').attr('content') ||
     $('meta[itemprop="dateCreated"]').attr('content') ||
    $('time[datetime]').attr('datetime');
  if (meta) {
    const d = parseDateLoose(meta);
    if (d) return d;
  }

  const candidates: string[] = [];
  $(
    'time, .date, .post-date, .entry-date, p.published, .published, .value.field_created',
  ).each((_idx, el) => {
    const t = $(el).attr('datetime') || $(el).text();
    if (t) candidates.push(t.trim());
  });

  $('[class*="date"]').each((_idx, el) => {
    const t = $(el).attr('datetime') || $(el).text();
    if (t) candidates.push(t.trim());
  });

  for (const s of candidates) {
    const d = parseDateLoose(s);
    if (d) return d;
  }

  const textNeedle = $('body').text();
  const match = textNeedle.match(/(?:Posted|Published)(?:\s+on)?\s*[:]?\s*([A-Za-z]{3,9}\.?\s+\d{1,2},?\s*\d{4})/i);
  if (match && match[1]) {
    const dd = parseDateLoose(match[1]);
    if (dd) return dd;
  }

  return undefined;
}

/** d 是否落入窗口 */
function inWindow(
  d: Date | null | undefined,
  tz = 'America/Moncton',
  startHour = 7,
  hours = 24,
): boolean {
  if (!d) return false;
  const now = dayjs().tz(tz);
  const windowEnd =
    now.hour() >= startHour
      ? now.hour(startHour).minute(0).second(0).millisecond(0)
      : now.subtract(1, 'day').hour(startHour).minute(0).second(0).millisecond(0);
  const windowStart = windowEnd.subtract(hours, 'hour');
  const dd = dayjs(d).tz(tz);
  return dd.isAfter(windowStart) && (dd.isBefore(windowEnd) || dd.isSame(windowEnd));
}

// ===== 主函数 =====
export async function scrapeByConfig(
  config: HtmlScraperConfig,
  opts: ScrapeOptions = {},
): Promise<FinalItem[]> {
  const debug = !!opts.debug || process.env.DEBUG === '1';
  const tz = opts.tz || 'America/Moncton';
  const startHour = opts.windowStartHour ?? 7;
  const windowHours = opts.windowHours ?? 24;

  if (!config.enabled) return [];

  // ===== 请求列表页 =====
  if (debug) {
    console.log(`[${config.id}] Fetch HTML list: ${config.url}`);
  }
  const { data: html } = await axios.get(config.url, {
    timeout: 20000,
    headers: {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml,application/xml',
      ...(config.headers || {}),
    },
    responseType: 'text',
    decompress: true,
    validateStatus: (s) => s >= 200 && s < 400,
  });

  const $ = cheerio.load(html);
  const sel = config.selectors!;
  let rows: RawRow[] = [];

  if (!sel || !sel.listItem) {
    if (debug) console.log(`[${config.id}] selectors.listItem 未配置，返回空`);
    return [];
  }

  // ===== 抓列表项 =====
  $(sel.listItem).each((_, li) => {
    const $li = $(li as AnyNode);

    // title
    let $t = sel.title ? $li.find(sel.title) : $li;
    if ($t.length === 0) $t = $li;
    let title = pickText($t as Cheerio<Element>);
    
    // 💡 使用增强后的标题清洗函数
    title = cleanTitleBySite(title, config.id);

    // link
    let href = '';
    if (sel.link) {
      const $a = $li.find(sel.link).first() as Cheerio<Element>;
      href = ($a.attr('href') || '').trim();
      if (!href) href = ($li.attr('href') || '').trim();
    } else {
      href = ($li.attr('href') || '').trim();
    }
    href = absUrl(href, config.baseUrl);

    // date
    let d: Date | undefined;
    if (sel.date) {
      let $d = $li.find(sel.date).first() as Cheerio<Element>;
      if (!$d.length) {
        $d = $li.nextAll(sel.date).first() as Cheerio<Element>;
      }
      if ($d.length) {
        const raw =
          sel.dateAttr === undefined || sel.dateAttr === null
            ? pickText($d)
            : pickAttr($d, sel.dateAttr);
        
        // 💡 使用增强后的日期解析函数 (NB Power 的日期会在这里被提取)
        d = parseDateLoose(raw);
      }
    }

    if (title && href) rows.push({ title, link: href, date: d });
  });

  const beforeFilter = rows.length;

  // ===== 统一过滤 =====
  let tmp = rows;

  if (config.linkIncludes?.length) {
    const incs = config.linkIncludes.map((x: string) => x.toLowerCase());
    tmp = tmp.filter((r) =>
      incs.some((inc: string) => r.link.toLowerCase().includes(inc)),
    );
  }

  if (config.linkExcludes?.length) {
    const exs = config.linkExcludes.map((x: string) => x.toLowerCase());
    tmp = tmp.filter(
      (r) => !exs.some((ex: string) => r.link.toLowerCase().includes(ex)),
    );
  }

  if (config.titleExcludes?.length) {
    const bads = config.titleExcludes.map((x: string) => x.toLowerCase());
    tmp = tmp.filter(
      (r) => !bads.some((bad: string) => r.title.toLowerCase().includes(bad)),
    );
  }

  rows = tmp;

  // 去重
  const beforeDedupe = rows.length;
  rows = dedupeByLink(rows);
  if (debug) {
    console.log(
      `[${config.id}] After dedupe by link: ${beforeDedupe} -> ${rows.length}`,
    );
  }

  // ===== 兜底逻辑 (锚点抓取) =====
  if (rows.length === 0) {
    const anchors: RawRow[] = [];
    $('a[href]').each((_, a) => {
      const $a = $(a as AnyNode) as Cheerio<Element>;
      const href = absUrl($a.attr('href') || '', config.baseUrl);
      const t = pickText($a);
      if (!href || !t) return;

      const hrefLower = href.toLowerCase();
      if (
        config.linkIncludes?.length &&
        !config.linkIncludes
          .map((x: string) => x.toLowerCase())
          .some((inc: string) => hrefLower.includes(inc))
      )
        return;

      if (
        config.linkExcludes?.length &&
        config.linkExcludes
          .map((x: string) => x.toLowerCase())
          .some((ex: string) => hrefLower.includes(ex))
      )
        return;

      if (anchors.some((x) => x.link === href)) return;
      anchors.push({ title: t, link: href });
    });

    rows = anchors.slice(0, 80);
    if (debug)
      console.log(
        `[${config.id}] rows empty -> fallback anchors collected: ${anchors.length}`,
      );
  }

  // ===== 详情抓取计划 =====
  const policy = config.detail || {};
  const needWhenNoDate = !!policy.fetchWhenNoDate;
  const always = !!policy.alwaysFetch;
  
  const toDetail = rows.filter((r) => always || (needWhenNoDate && !r.date));
  
  const limiter = pLimit(Math.max(1, policy.concurrency ?? 3));

  if (debug) {
    console.log(
      `[${config.id}] Detail plan: total=${rows.length}, toDetail=${toDetail.length}`,
    );
  }

  // ===== 抓详情拿日期 + 全文正文 =====
  await Promise.all(
    toDetail.map((r) =>
      limiter(async () => {
        try {
          let fetchLink = r.link;

          // 🚨 【保留关键逻辑】GNB URL 替换
          // 解决 GNB 详情页空壳问题，直接替换为 nocache.html
          if (config.id === 'gnb-news-en') {
            fetchLink = fetchLink
              .replace('/news_release.', '/news_release/_jcr_content/mainContent_par/newsarticle.')
              .replace('.html', '.nocache.html');
          }

          const { data: detailHtml } = await axios.get(fetchLink, {
            timeout: 20000,
            headers: { 'User-Agent': UA, ...(config.headers || {}) },
            responseType: 'text',
            decompress: true,
            validateStatus: (s) => s >= 200 && s < 400,
          });
          const $$ = cheerio.load(detailHtml);
          
          if (!r.date) {
            const dd = extractDetailDate($$);
            if (dd) r.date = dd;
          }

          // 提取全文
          (r as any).content = extractMainContent($$, config);
          
        } catch (e) {
          if (debug)
            console.log(
              `[${config.id}] detail fetch fail: ${r.link}`,
              (e as Error).message,
            );
        }
      }),
    ),
  );

  // ===== 时间窗口过滤 =====
  let kept = rows;
  if (!opts.ignoreWindow) {
    kept = kept.filter((r) => inWindow(r.date, tz, startHour, windowHours));
  } else {
    if (debug) console.log(`[${config.id}] Window filter skipped.`);
  }

  // ===== 截断 & 输出 =====
  if (config.maxItems && kept.length > config.maxItems) {
    kept = kept.slice(0, config.maxItems);
  }

  const final: FinalItem[] = kept.map((r) => ({
    title: r.title,
    link: r.link,
    date: r.date ?? undefined,
    source: config.id,
    content: (r as any).content
  }));

  if (debug) {
    console.log(`[${config.id}] Kept after window: ${final.length}`);
  }
  return final;
}