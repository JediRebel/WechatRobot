// src/scrapers/sj-police.ts
import axios from 'axios';
import * as cheerio from 'cheerio';
import { NewsArticle } from '../utils/types';
import { isWithinTimeWindow, normalizeText } from '../utils/helpers';

const LIST_URL = 'https://saintjohnpolice.ca/media-release/';

// 仅保留真正的详情页链接（排除根栏目、法语根页、锚点）
function isValidDetailUrl(full: string): boolean {
  // 排除根栏目页、法语根页、锚点
  if (/^https?:\/\/[^/]+\/(fr\/)?media-release\/(#.*)?$/i.test(full)) return false;
  // 只要路径里包含 /media-release/ 且不是以上根路径即可
  return /\/media-release\//i.test(full);
}

export async function scrape(): Promise<NewsArticle[]> {
  const articles: NewsArticle[] = [];
  const seenLinks = new Set<string>();
  const seenTitleKeys = new Set<string>();

  try {
    // 1) 抓取归档页
    const { data: listHtml } = await axios.get(LIST_URL, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      timeout: 20000,
    });
    const $ = cheerio.load(listHtml);

    // 2) 收集候选详情链接（不依赖脆弱的 class）
    const linkSet = new Set<string>();
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href')?.trim();
      if (!href) return;
      const full = href.startsWith('http') ? href : new URL(href, LIST_URL).href;
      if (isValidDetailUrl(full)) linkSet.add(full);
    });

    // 3) 逐个详情页解析标题与时间
    for (const url of linkSet) {
      try {
        // 链接去重
        if (seenLinks.has(url)) continue;

        const { data: detailHtml } = await axios.get(url, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          timeout: 20000,
        });
        const $$ = cheerio.load(detailHtml);

        // 标题：优先 <h1>，兜底 og:title
        const title =
          $$('h1').first().text().trim() ||
          $$('meta[property="og:title"]').attr('content')?.trim() ||
          '';
        if (!title) continue;

        // 标题指纹去重
        const titleKey = normalizeText(title);
        if (seenTitleKeys.has(titleKey)) continue;

        // 日期：多种兜底方案
        let dateStr =
          $$('time[datetime]').attr('datetime')?.trim() ||
          $$('time').first().text().trim() ||
          $$('meta[property="article:published_time"]').attr('content')?.trim() ||
          $$('.single__meta, .entry-meta, .posted-on').text().trim();

        // 解析时间；失败则用抓取时间兜底（但仍需通过时间窗口校验）
        let date = new Date();
        if (dateStr) {
          const tryDate = new Date(dateStr);
          if (!isNaN(tryDate.getTime())) date = tryDate;
        }

        // ✅ 严格时间窗口过滤（NB省 06:00 ~ 次日06:00）
        if (!isWithinTimeWindow(date.toISOString())) continue;

        // 收录
        seenLinks.add(url);
        seenTitleKeys.add(titleKey);
        articles.push({
          title,
          link: url,
          date,
          source: 'sj-police',
        });
      } catch {
        // 单条失败不影响整体
        continue;
      }
    }

    // 4) 时间倒序 &（可选）限制数量
    articles.sort((a, b) => b.date.getTime() - a.date.getTime());
    return articles; // 如需限制条数可改成 .slice(0, 10)
  } catch (err) {
    console.error('[SJ Police] 列表抓取失败:', err);
    return [];
  }
}