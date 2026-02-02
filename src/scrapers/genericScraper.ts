// src/scrapers/genericScraper.ts
/* eslint-disable no-console */

// ===== 依赖模块 (Dependencies) =====
import axios from 'axios';
import pLimit from 'p-limit';

// cheerio
import * as cheerio from 'cheerio';
import type { Cheerio } from 'cheerio';
import type { AnyNode, Element } from 'domhandler';

// dayjs + 时区插件
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
dayjs.extend(utc);
dayjs.extend(timezone);

// 统一从 utils/types 引入类型定义
import type {
  HtmlScraperConfig,
  ScrapeOptions,
  RawNewsRow as RawRow,
} from '../utils/types';

// ===== 仅在本文件使用的输出接口 =====
export interface FinalItem {
  title: string;
  link: string;
  date?: Date;
  source: string;
  content?: string; // ✅ 用于存储抓取到的正文全文
}

// ===== 工具函数 (Utility Functions) =====
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

/** * ✅ 模块：强力清洗标题 
 * 处理 NB Power 的换行符、空白以及特殊的日期后缀
 */
function cleanTitleBySite(raw: string, sourceId: string): string {
  if (!raw) return '';

  // 1️⃣ 暴力清洗：把所有 换行(\n)、回车(\r)、制表符(\t) 统统变成空格
  let t = raw.replace(/[\r\n\t]+/g, ' ');
  
  // 2️⃣ 压缩多余空格
  t = t.replace(/\s+/g, ' ').trim();

  // 3️⃣ Quispamsis 专用清理
  if (sourceId === 'quispamsis') {
    t = t.replace(/By Town of Quispamsis\s*$/i, '').trim();
  }

  // 4️⃣ NB Power 特殊处理：切掉标题末尾的日期
  if (sourceId === 'nb-power') {
    t = t.replace(/\s*-\s*\d{4}-\d{2}-\d{2}[\s\S]*$/, '').trim();
  }

  return t;
}

/** * ✅ 模块：核心正文提取 
 * 包含对 CTV (Fusion API) 的特种抓取以及常规 HTML 容器匹配
 */
function extractMainContent($: cheerio.CheerioAPI, config: HtmlScraperConfig): string {
  // 1️⃣ 【特种部队策略】优先检查 CTV/Fusion 架构的元数据 (JSON)
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
      // JSON 解析失败则忽略，继续往下执行
    }
  }

  // 移除无关的 HTML 噪音元素
  $('script, style, nav, footer, header, aside, .sidebar, .menu, .ads, .nav, .alert, .ad, iframe, .c-related-stories, .pp-multiple-authors-boxes-wrapper').remove();

  let content = '';

  // 2️⃣ 优先使用配置文件中手动指定的 content 选择器
  if (config.selectors?.content) {
    const $els = $(config.selectors.content);
    if ($els.length > 0) {
      content = $els.map((_, el) => $(el).text().trim()).get().join(' ');
    }
  }

  // 3️⃣ 智能匹配常见的正文容器
  if (!content) {
    const contentSelectors = [
      'article', '.content', '.post-content', '.entry-content', '.article-body',
      'main', '#main-content', '.field-item', '.node__content', '.body-text',
      '#content', '.view-content', '.b-article-body'
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

  // 4️⃣ 兜底提取所有的 p 标签文本
  if (!content) {
    const paragraphs = $('p').map((_, el) => $(el).text().trim()).get();
    content = paragraphs.join(' ').trim();
  }

  // 🧹 Country 94 专用噪音清理
  if (config.id === 'country94') {
    const noiseTriggers = [
      'Current weather conditions', 'View all posts', 'Do you have a news tip', 'Newsletter Signup'
    ];
    for (const trigger of noiseTriggers) {
      const regex = new RegExp(`${trigger}[\\s\\S]*$`, 'i');
      content = content.replace(regex, '');
    }
  }
  
  return content.replace(/\s+/g, ' ').trim();
}

/** * ✅ 模块：数据去重 
 * 按 URL 和 标题双重判断，防止同一篇文章在页面不同位置出现
 */
function dedupeByLink(rows: RawRow[]): RawRow[] {
  const seenLink = new Set<string>();
  const seenTitle = new Set<string>();
  return rows.filter((r) => {
    const lKey = (r.link || '').toLowerCase();
    const tKey = (r.title || '').trim().toLowerCase();
    if (!lKey || !tKey) return false;
    
    // 如果链接重复或标题完全重复，则视为同一条，剔除之
    if (seenLink.has(lKey) || seenTitle.has(tKey)) return false;
    
    seenLink.add(lKey);
    seenTitle.add(tKey);
    return true;
  });
}

/** * ✅ 模块：宽松解析日期 
 * 解决 NB Power 日期嵌入在标题文本中的复杂情况
 */
function parseDateLoose(input?: string): Date | undefined {
  if (!input) return undefined;
  
  const s = input.trim();

  // 尝试提取标准的 YYYY-MM-DD 格式
  const isoMatch = s.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (isoMatch) {
    const d = dayjs(isoMatch[1]);
    if (d.isValid()) return d.toDate();
  }
  
  // 基础清理：移除 "Posted on", "Published at" 等前缀
  let clean = s
    .replace(/^(posted|published)(?:\s+on)?\s*[:]?\s*/i, '') 
    .replace(/\s+at\s+/i, ' ')
    .replace('|', ' ')
    .replace(/(\d+)(st|nd|rd|th)/gi, '$1')
    .replace(/,+/g, ',')
    .trim();

  // 移除常见的分类后缀（如 "in Local News"）
  const inIndex = clean.indexOf(' in ');
  if (inIndex > 0) {
    const candidate = clean.substring(0, inIndex).trim();
    const d = dayjs(candidate);
    if (d.isValid()) return d.toDate();
  }

  // 尝试直接解析
  const d = dayjs(clean);
  if (d.isValid()) return d.toDate();

  // 最终兜底
  const native = new Date(clean);
  return Number.isNaN(native.getTime()) ? undefined : native;
}

/** * ✅ 模块：从详情页元数据中提取日期 
 */
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

  // 从正文文本中提取
  const textNeedle = $('body').text();
  const match = textNeedle.match(/(?:Posted|Published)(?:\s+on)?\s*[:]?\s*([A-Za-z]{3,9}\.?\s+\d{1,2},?\s*\d{4})/i);
  if (match && match[1]) {
    const dd = parseDateLoose(match[1]);
    if (dd) return dd;
  }

  return undefined;
}

/** 检查日期是否在采集的时间窗口内 */
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

// ===== 主抓取函数 (Main Execution Flow) =====

export async function scrapeByConfig(
  config: HtmlScraperConfig,
  opts: ScrapeOptions = {},
): Promise<FinalItem[]> {
  const debug = !!opts.debug || process.env.DEBUG === '1';
  const tz = opts.tz || 'America/Moncton';
  const startHour = opts.windowStartHour ?? 7;
  const windowHours = opts.windowHours ?? 24;

  if (!config.enabled) return [];

  // 1. 请求列表页面内容
  if (debug) console.log(`[${config.id}] Fetch HTML list: ${config.url}`);
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

  // 2. 遍历并抓取列表项信息
  $(sel.listItem).each((_, li) => {
    const $li = $(li as AnyNode);

    // 提取标题 (Title)
    let $t = sel.title ? $li.find(sel.title) : $li;
    if ($t.length === 0) $t = $li;
    let title = pickText($t as Cheerio<Element>);
    title = cleanTitleBySite(title, config.id);

    // 提取链接 (Link)
    let href = '';
    if (sel.link) {
      const $a = $li.find(sel.link).first() as Cheerio<Element>;
      href = ($a.attr('href') || '').trim();
      if (!href) href = ($li.attr('href') || '').trim();
    } else {
      href = ($li.attr('href') || '').trim();
    }
    href = absUrl(href, config.baseUrl);

    // 提取日期 (Date)
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
        d = parseDateLoose(raw);
      }
    }

    if (title && href) rows.push({ title, link: href, date: d });
  });

  // 🚨 3. [核心优化：垃圾链接/导航自动化过滤]
  // 防止抓到 "FR", "EN", "English", "Français", "Search" 等噪音链接
  rows = rows.filter(r => {
    const t = r.title.trim();
    const l = r.link.toLowerCase();

    // A. 标题过短判定 (低于 3 个字符的新闻标题几乎不存在)
    if (t.length <= 2) return false;

    // B. 显式语言切换、搜索、主页关键词排除
    const langBads = ['français', 'english', 'french', 'fr/en', 'search', 'home', 'next', 'previous'];
    if (langBads.includes(t.toLowerCase())) return false;

    // C. 无效链接特征排除 (Javascript, Mailto, 社交媒体链接等)
    const navBads = ['javascript:', 'mailto:', '#content', '/search', 'facebook.com', 'twitter.com', 'instagram.com'];
    if (navBads.some(bad => l.includes(bad))) return false;

    return true;
  });

  // 4. 基于配置文件定义的 Include/Exclude 规则过滤
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

  // 5. 执行数据去重 (URL + Title)
  rows = dedupeByLink(rows);

  // 6. 兜底逻辑：如果规则过滤后啥也没剩下，尝试在页面中全面扫锚点
  if (rows.length === 0) {
    const anchors: RawRow[] = [];
    $('a[href]').each((_, a) => {
      const $a = $(a as AnyNode) as Cheerio<Element>;
      const href = absUrl($a.attr('href') || '', config.baseUrl);
      const t = pickText($a);
      if (!href || !t || t.length <= 2) return; 

      const hrefLower = href.toLowerCase();
      if (config.linkIncludes?.length && !config.linkIncludes.map(x => x.toLowerCase()).some(inc => hrefLower.includes(inc))) return;
      if (config.linkExcludes?.length && config.linkExcludes.map(x => x.toLowerCase()).some(ex => hrefLower.includes(ex))) return;
      if (anchors.some((x) => x.link === href)) return;
      
      anchors.push({ title: t, link: href });
    });
    rows = anchors.slice(0, 80);
  }

  // 7. 详情页采集计划：补全缺失日期，抓取正文全文
  const policy = config.detail || {};
  const needWhenNoDate = !!policy.fetchWhenNoDate;
  const always = !!policy.alwaysFetch;
  const toDetail = rows.filter((r) => always || (needWhenNoDate && !r.date));
  const limiter = pLimit(Math.max(1, policy.concurrency ?? 3));

  await Promise.all(
    toDetail.map((r) =>
      limiter(async () => {
        try {
          let fetchLink = r.link;
          
          // 🚨 【GNB 专用逻辑】将空壳链接替换为 nocache 页面，确保能抓到真实 HTML
          if (config.id === 'gnb-news-en') {
            fetchLink = fetchLink
              .replace('/news_release.', '/news_release/_jcr_content/mainContent_par/newsarticle.')
              .replace('.html', '.nocache.html');
          }

          const { data: detailHtml } = await axios.get(fetchLink, {
            timeout: 20000,
            headers: { 'User-Agent': UA, ...(config.headers || {}) },
            responseType: 'text',
          });
          const $$ = cheerio.load(detailHtml);
          
          if (!r.date) {
            const dd = extractDetailDate($$);
            if (dd) r.date = dd;
          }

          // 核心逻辑：抓取正文全文用于后续 AI 处理
          (r as any).content = extractMainContent($$, config);
          
        } catch (e) {
          if (debug) console.log(`[${config.id}] detail fetch fail: ${r.link}`, (e as Error).message);
        }
      }),
    ),
  );

  // 8. 最终过滤：时间窗口判定
  let kept = rows;
  if (!opts.ignoreWindow) {
    kept = kept.filter((r) => inWindow(r.date, tz, startHour, windowHours));
  }

  // 9. 截取并构造最终输出结果
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

  return final;
}