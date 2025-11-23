// src/scrapers/dsfs.ts
import axios from 'axios';
import * as cheerio from 'cheerio';
import { NewsArticle } from 'utils/types';
import { isWithinAtlanticWindowByDate } from '../utils/helpers';
// 在 src/test-dsfs.ts 里临时加这段
import { getAtlanticTimeRange } from '../utils/helpers';

const { start, end } = getAtlanticTimeRange();
console.log('Atlantic window:', start.toISO(), '→', end.toISO());

const LIST_URLS = [
  'https://francophonesud.nbed.nb.ca/district-scolaire/nouvelles',
  'https://francophonesud.nbed.nb.ca/district-scolaire/nouvelles/',
];
const BASE = 'https://francophonesud.nbed.nb.ca';

const IGNORE_WINDOW =
  process.env.SKIP_WINDOW === '1' || process.argv.includes('--all');
const DEBUG = process.env.DEBUG === '1' || process.argv.includes('--debug');

function log(...args: any[]) {
  if (DEBUG) console.log(...args);
}

function absUrl(href = ''): string {
  try {
    if (!href) return '';
    if (/^https?:\/\//i.test(href)) return href;
    return new URL(href, BASE).toString();
  } catch {
    return href;
  }
}

function pickTitle($$: cheerio.CheerioAPI): string {
  const og =
    $$('meta[property="og:title"]').attr('content')?.trim() ||
    $$('meta[name="title"]').attr('content')?.trim() ||
    '';
  const h1 =
    $$('h1').first().text().trim() ||
    $$('article h1, article header h1').first().text().trim() ||
    $$('.page-title').first().text().trim() ||
    '';
  const doc = $$('title').text().trim();
  return og || h1 || doc || '';
}

function parseDateFromJsonLd($$: cheerio.CheerioAPI): Date | null {
  let found: Date | null = null;
  $$('script[type="application/ld+json"]').each((_, el) => {
    try {
      const txt = $$(el).contents().text().trim();
      if (!txt) return;
      const json = JSON.parse(txt);
      const arr = Array.isArray(json) ? json : [json];
      for (const node of arr) {
        const iso =
          node?.datePublished ||
          node?.dateModified ||
          node?.articleBody?.datePublished ||
          '';
        if (iso) {
          const d = new Date(iso);
          if (!isNaN(d.getTime())) {
            found = d;
            return false;
          }
        }
      }
    } catch {}
  });
  return found;
}

function parseDateFallback($$: cheerio.CheerioAPI): Date | null {
  const t = $$('time').first();
  if (t.length) {
    const iso = t.attr('datetime')?.trim() || t.text().trim() || '';
    if (iso) {
      const d = new Date(iso);
      if (!isNaN(d.getTime())) return d;
    }
  }
  const meta =
    $$('meta[property="article:published_time"]').attr('content')?.trim() || '';
  if (meta) {
    const d = new Date(meta);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

function parseDateFromUrl(url: string): Date | null {
  const m = url.match(/\/(20\d{2})[/-](\d{1,2})[/-](\d{1,2})\b/);
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const res = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept-Language': 'fr-CA,fr;q=0.9,en;q=0.6',
      },
      timeout: 20000,
      // 不自定义 validateStatus，让 axios 自己跟随 30x；若仍非 2xx，会 throw，
      // 我们在 catch 中尽量从 error.response.data 兜底。
    });
    return res.data;
  } catch (err: any) {
    const html = err?.response?.data;
    if (typeof html === 'string' && html.length) {
      log('⚠️ 非 2xx，但拿到 HTML，继续解析');
      return html;
    }
    log('❌ 请求失败，且无 HTML 可用：', url, err?.message || err);
    return null;
  }
}

export async function scrape(): Promise<NewsArticle[]> {
  // 1) 取列表页（两个 URL 依次尝试）
  let listHtml: string | null = null;
  for (const u of LIST_URLS) {
    listHtml = await fetchHtml(u);
    if (listHtml) break;
  }
  if (!listHtml) {
    log('❌ 列表页获取失败（两个 URL 都不可用）');
    return [];
  }
  const $ = cheerio.load(listHtml);

  // 2) 宽选法：抓所有 <a>，再按正则筛新闻详情链接
  const allAs = $('a');
  const candidates = new Set<string>();
  allAs.each((_, a) => {
    const href = ($(a).attr('href') || '').trim();
    const full = absUrl(href);
    if (
      /\/district-scolaire\/nouvelles\/\d+/.test(full) &&
      !full.endsWith('/nouvelles') &&
      !full.endsWith('/nouvelles/')
    ) {
      candidates.add(full);
    }
  });

  const links = Array.from(candidates);
  log('🧩 候选链接数：', links.length);
  if (DEBUG) log(links);

  // 没候选就直接返回
  if (!links.length) return [];

  // 3) 逐详情解析
  const out: NewsArticle[] = [];
  for (const url of links.slice(0, 30)) {
    const html = await fetchHtml(url);
    if (!html) continue;

    const $$ = cheerio.load(html);
    const title = pickTitle($$).trim();
    if (!title) {
      log('⏭️ 跳过（无标题）：', url);
      continue;
    }

    let date: Date | null = parseDateFromJsonLd($$);
    if (!date) date = parseDateFallback($$);
    if (!date) date = parseDateFromUrl(url);

    // 再兜底：HTTP 头 Last-Modified —— 只有当 axios 成功返回时可用，
    // fetchHtml 已经把非 2xx转成 string，所以这里没 header 了，放弃这个兜底。

    if (!date || isNaN(date.getTime())) {
      log('⏭️ 跳过（无可解析时间）：', title);
      continue;
    }

    if (!IGNORE_WINDOW && !isWithinAtlanticWindowByDate(date)) {
      log('⏭️ 跳过（不在 07→07 窗口）：', title, date.toISOString());
      continue;
    }

    out.push({ title, link: url, date, source: 'dsfs' });
  }

  log('✅ 最终保留：', out.length);
  return out;
}


