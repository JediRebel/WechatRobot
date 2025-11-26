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

function cleanTitleBySite(raw: string, sourceId: string): string {
  // 1️⃣ 先统一清理空白：把换行、Tab、多空格都变成一个空格
  let t = raw.replace(/\s+/g, ' ').trim();

  // 2️⃣ Quispamsis：去掉末尾的 "By Town of Quispamsis"
  if (sourceId === 'quispamsis') {
    t = t.replace(/By Town of Quispamsis\s*$/i, '').trim();
  }

  // 3️⃣ NB Power：去掉末尾的日期 " - 2025-07-14"
  if (sourceId === 'nb-power') {
    t = t.replace(/\s*-\s*\d{4}-\d{2}-\d{2}$/, '').trim();
  }

  return t;
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

/** 宽松解析英文日期为 Date */
function parseDateLoose(input?: string): Date | undefined {
  if (!input) return undefined;
  const s = input
    .replace(/^(posted|published)\s*:\s*/i, '')
    .replace(/\s+at\s+/i, ' ')
    .replace(/(\d+)(st|nd|rd|th)/gi, '$1')
    .replace(/,+/g, ',')
    .trim();
  const d = dayjs(s);
  if (d.isValid()) return d.toDate();

  // 兜底：让原生 Date 再尝试一次（例如 "24 November 2025"）
  const native = new Date(s);
  return Number.isNaN(native.getTime()) ? undefined : native;
}

/** 从详情页尽量找日期 */
function extractDetailDate($: cheerio.CheerioAPI): Date | undefined {
  // 1) 先尝试 meta / time[datetime]
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

  // 2) 再从常见的日期元素里找一圈
  const candidates: string[] = [];

  // 传统选择器 + Quispamsis 自己的 class
  $(
    'time, .date, .post-date, .entry-date, p.published, .published, .value.field_created',
  ).each((_idx, el) => {
    const t = $(el).attr('datetime') || $(el).text();
    if (t) candidates.push(t.trim());
  });

  // 3) 兜底：再扫一遍 class 里带 date 的元素（避免遗漏其它新站点）
  $('[class*="date"]').each((_idx, el) => {
    const t = $(el).attr('datetime') || $(el).text();
    if (t) candidates.push(t.trim());
  });

  for (const s of candidates) {
    const d = parseDateLoose(s);
    if (d) return d;
  }

  // 4) 兜底：文中出现 "Posted: <日期>" 或 "Published: <日期>"
  const textNeedle = $('body').text();
  const match = textNeedle.match(/(?:Posted|Published)\\s*:\\s*([A-Za-z]{3,9}\\.?\\s+\\d{1,2},\\s*\\d{4})/i);
  if (match && match[1]) {
    const dd = parseDateLoose(match[1]);
    if (dd) return dd;
  }

  return undefined;
}

/** d 是否落入 [windowStart, windowEnd]（含 end） */
function inWindow(
  d: Date | null | undefined,
  tz = 'America/Moncton',
  startHour = 7,
  hours = 24,
): boolean {
  if (!d) return false; // 同时拦住 undefined / null
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
    title = cleanTitleBySite(title, config.id);

    // link
    let href = '';
    if (sel.link) {
      const $a = $li.find(sel.link).first() as Cheerio<Element>;
      href = ($a.attr('href') || '').trim();
      // 若 listItem 本身是 <a>，则用自身 href 兜底
      if (!href) href = ($li.attr('href') || '').trim();
    } else {
      // 当未配置 link 选择器时，尝试直接读取 listItem 的 href
      href = ($li.attr('href') || '').trim();
    }
    href = absUrl(href, config.baseUrl);

    // date
    let d: Date | undefined;
    if (sel.date) {
      let $d = $li.find(sel.date).first() as Cheerio<Element>;
      // 若当前节点内未找到日期，尝试查找后续兄弟（兼容列表结构中日期在紧随 h2 后的场景）
      if (!$d.length) {
        $d = $li.nextAll(sel.date).first() as Cheerio<Element>;
      }
      if ($d.length) {
        const raw =
          sel.dateAttr === undefined || sel.dateAttr === null
            ? pickText($d)
            : pickAttr($d, sel.dateAttr);
        d = parseDateLoose(raw);
      }
    }

    if (title && href) rows.push({ title, link: href, date: d });
  });

  const beforeFilter = rows.length;

  // ===== 统一过滤 =====
  let tmp = rows;

  if (config.linkIncludes?.length) {
    const before = tmp.length;
    const incs = config.linkIncludes.map((x: string) => x.toLowerCase());
    tmp = tmp.filter((r) =>
      incs.some((inc: string) => r.link.toLowerCase().includes(inc)),
    );
    if (debug)
      console.log(
        `[${config.id}] linkIncludes filter (${config.linkIncludes.join(', ')}): ${before} -> ${tmp.length}`,
      );
  }

  if (config.linkExcludes?.length) {
    const before = tmp.length;
    const exs = config.linkExcludes.map((x: string) => x.toLowerCase());
    tmp = tmp.filter(
      (r) => !exs.some((ex: string) => r.link.toLowerCase().includes(ex)),
    );
    if (debug)
      console.log(
        `[${config.id}] linkExcludes filter (${config.linkExcludes.join(', ')}): ${before} -> ${tmp.length}`,
      );
  }

  if (config.titleExcludes?.length) {
    const before = tmp.length;
    const bads = config.titleExcludes.map((x: string) => x.toLowerCase());
    tmp = tmp.filter(
      (r) => !bads.some((bad: string) => r.title.toLowerCase().includes(bad)),
    );
    if (debug)
      console.log(
        `[${config.id}] titleExcludes filter (${config.titleExcludes.join(', ')}): ${before} -> ${tmp.length}`,
      );
  }

  rows = tmp;

  // 去重：防止同一链接出现多次（例如 SJ 列表里重复的条目）
  const beforeDedupe = rows.length;
  rows = dedupeByLink(rows);
  if (debug) {
    console.log(
      `[${config.id}] After dedupe by link: ${beforeDedupe} -> ${rows.length}`,
    );
  }

  // ===== 如果一个都没有，降级：全页 a[href] 作为兜底 =====
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

      if (
        config.titleExcludes?.length &&
        config.titleExcludes
          .map((x: string) => x.toLowerCase())
          .some((bad: string) => t.toLowerCase().includes(bad))
      )
        return;

      if (anchors.some((x) => x.link === href)) return;
      anchors.push({ title: t, link: href });
    });

    rows = anchors.slice(0, 80);
    if (debug)
      console.log(
        `[${config.id}] rows empty -> fallback anchors collected: ${anchors.length}, kept=${rows.length}`,
      );
  }

  if (debug) {
    console.log(
      `[${config.id}] Raw rows from listItem "${sel.listItem}": ${beforeFilter}`,
    );
    console.log(
      `[${config.id}] List rows after unified filters: ${beforeFilter} -> ${rows.length}`,
    );
  }

  // ===== 详情抓取计划 =====
  const policy = config.detail || {};
  const needWhenNoDate = !!policy.fetchWhenNoDate;
  const always = !!policy.alwaysFetch;
  const toDetail = rows.filter((r) => always || (needWhenNoDate && !r.date));
  const limiter = pLimit(Math.max(1, policy.concurrency ?? 3));

  if (debug) {
    const noDate = rows.filter((r) => !r.date).length;
    console.log(
      `[${config.id}] Detail plan: total=${rows.length}, noDate=${noDate}, toDetail=${toDetail.length}, concurrency=${policy.concurrency ?? 3}, alwaysFetch=${always}`,
    );
  }

  // ===== 抓详情拿日期 =====
  await Promise.all(
    toDetail.map((r) =>
      limiter(async () => {
        try {
          const { data: detailHtml } = await axios.get(r.link, {
            timeout: 20000,
            headers: { 'User-Agent': UA, ...(config.headers || {}) },
            responseType: 'text',
            decompress: true,
            validateStatus: (s) => s >= 200 && s < 400,
          });
          const $$ = cheerio.load(detailHtml);
          const dd = extractDetailDate($$);
          if (dd) r.date = dd;
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
    const before = kept.length;
    kept = kept.filter((r) => inWindow(r.date, tz, startHour, windowHours));
    if (debug)
      console.log(
        `[${config.id}] Window filter (${tz} ${startHour}→${(startHour + windowHours) % 24}, IGNORE_WINDOW=${!!opts.ignoreWindow}): ${before} -> ${kept.length}`,
      );
  } else {
    if (debug)
      console.log(
        `[${config.id}] Window filter skipped (IGNORE_WINDOW=true). kept=${kept.length}`,
      );
  }

  // ===== 截断 & 输出 =====
  if (config.maxItems && kept.length > config.maxItems) {
    kept = kept.slice(0, config.maxItems);
  }

  const final: FinalItem[] = kept.map((r) => ({
    title: r.title,
    link: r.link,
    date: r.date ?? undefined, // 把 null 规整为 undefined，匹配 FinalItem
    source: config.id,
  }));

  if (debug) {
    console.log(`[${config.id}] Kept after window: ${final.length}`);
  }
  return final;
}
