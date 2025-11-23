// src/scrapers/huddle.ts
import axios from 'axios';
import * as cheerio from 'cheerio';
import { NewsArticle } from 'utils/types';
import { isWithinTimeWindow } from '../utils/helpers';

const HUDDLE_URL = 'https://huddle.today/';

export async function scrape(): Promise<NewsArticle[]> {
  const articles: NewsArticle[] = [];

  try {
    const { data: html } = await axios.get(HUDDLE_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
      }
    });
    const $ = cheerio.load(html);

    $('.jeg_post').each((_, el) => {
      const title = $(el).find('.jeg_post_title a').text().trim();
      const link = $(el).find('.jeg_post_title a').attr('href')?.trim();
      const dateText = $(el).find('time').attr('datetime') || '';

      if (!title || !link) return;

      let date = new Date();
      if (dateText) {
        const parsedDate = new Date(dateText);
        if (!isNaN(parsedDate.getTime())) {
          date = parsedDate;
        }
      }

      // 过滤 06:00 ~ 次日 06:00 的新闻
      if (isWithinTimeWindow(date.toISOString())) {
        articles.push({
          title,
          link,
          date,
          source: 'huddle'
        });
      }
    });
  } catch (err) {
    console.error('[Huddle] 抓取失败:', err);
  }

  return articles;
}