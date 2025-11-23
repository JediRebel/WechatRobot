// src/sources/cbc.ts

import axios from 'axios';
import * as cheerio from 'cheerio';
import { NewsArticle } from '../utils/types';
import {
  isWithinTimeWindow,
  formatDateTime,
  normalizeText,
  getRegionPriority,
} from '../utils/helpers';

const CBC_URL = 'https://www.cbc.ca/news/canada/new-brunswick';

export async function scrape(): Promise<NewsArticle[]> {
  const articles: NewsArticle[] = [];

  try {
    const { data: html } = await axios.get(CBC_URL);
    console.log(html.slice(0, 500));
    const $ = cheerio.load(html);

    $('a.card').each((_, el) => {
      const title = $(el).find('.headline').text().trim();
      const link = $(el).attr('href')?.trim();
      const fullLink = link?.startsWith('http') ? link : `https://www.cbc.ca${link}`;

      if (!title || !link) return;

      // 由于 CBC 不提供明确时间戳，我们使用当前时间作为抓取时间
      const date = new Date();
      const isoDate = date.toISOString();

      // 使用时间窗口进行筛选（Atlantic 06:00 - 次日 06:00）
      if (!isWithinTimeWindow(isoDate)) return;

      articles.push({
        title,
        link: fullLink!,
        date,
        source: 'cbc',
      });
    });
  } catch (err) {
    console.error('❌ CBC 抓取失败:', err);
  }

  return articles;
}