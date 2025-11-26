// src/scrapers/rcmp.ts
/* eslint-disable no-console */

import puppeteer from 'puppeteer';
import { NewsArticle, ScrapeOptions } from '../utils/types';
import { isWithinTimeWindow } from '../utils/helpers';

function absUrl(href: string): string {
  if (!href) return '';
  if (/^https?:\/\//i.test(href)) return href;
  return new URL(href, 'https://rcmp.ca').toString();
}

function extractLink(html: string): string {
  // 支持 href="..."、href='...'、href=无引号
  const m = html.match(/href\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i);
  const raw = m?.[1] || m?.[2] || m?.[3] || '';
  return raw ? absUrl(raw) : '';
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

export async function scrape(opts: ScrapeOptions = {}): Promise<NewsArticle[]> {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  await page.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  );

  try {
    await page.goto('https://rcmp.ca/en/nb/news', {
      waitUntil: 'networkidle2',
      timeout: 60000,
    });

    // 等待 DataTables 初始化并有数据
    await page.waitForFunction(
      () =>
        (window as any).jQuery &&
        (window as any).jQuery.fn &&
        (window as any).jQuery.fn.DataTable &&
        (window as any).jQuery('#n').DataTable().data().length > 0,
      { timeout: 20000 },
    );

    const rows = await page.evaluate(() => {
      const $ = (window as any).jQuery || (window as any).$;
      if (!$ || !$.fn.DataTable) return [];
      const dt = $('#n').DataTable();
      return dt.data().toArray();
    });

    if (opts.debug) console.log(`[rcmp-nb] rows in DataTable: ${rows.length}`);

    const articles: NewsArticle[] = [];

    for (const r of rows) {
      const titleHtml: string = r.title || '';
      const link = extractLink(titleHtml);
      const title = stripHtml(titleHtml);
      const dateStr: string = r.date || '';
      const date = dateStr ? new Date(dateStr) : new Date();

      if (!title || !link) continue;
      if (!opts.ignoreWindow && !isWithinTimeWindow(date.toISOString())) continue;

      articles.push({
        title,
        link,
        date,
        source: 'rcmp-nb',
      });
    }

    // 按时间倒序
    articles.sort((a, b) => b.date.getTime() - a.date.getTime());
    const limit = 5;
    return articles.slice(0, limit);
  } catch (e) {
    console.error('[rcmp-nb] scrape failed:', (e as Error).message);
    return [];
  } finally {
    await browser.close();
  }
}
