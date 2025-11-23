// src/scrapers/tj.ts
import puppeteer, { Page } from 'puppeteer';
import axios from 'axios';
import { NewsArticle } from 'utils/types';
import { isWithinTimeWindow } from '../utils/helpers';

const TJ_URL = 'https://tj.news/';

// 自动滚动函数
async function autoScroll(page: Page) {
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      let totalHeight = 0;
      const distance = 400;
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;

        if (totalHeight >= scrollHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 500);
    });
  });
}

export async function scrape(): Promise<NewsArticle[]> {
  const articles: NewsArticle[] = [];

  try {
    console.log('🌐 打开 TJ 首页...');
    const browser = await puppeteer.launch({
      headless: true, // 无头模式
    });
    const page = await browser.newPage();

    // 设置 User-Agent 模拟真实浏览器
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36'
    );

    await page.goto(TJ_URL, { waitUntil: 'networkidle2', timeout: 60000 });

    // 等 5 秒让页面资源加载完全
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // 滚动页面加载更多
    await autoScroll(page);

    // 截取 Taboola API 请求
    let apiUrl: string | null = null;
    page.on('request', (request) => {
      const url = request.url();
      if (url.includes('trc.taboola.com') && url.endsWith('/json')) {
        apiUrl = url;
      }
    });

    // 再等 5 秒抓取网络请求
    await new Promise((resolve) => setTimeout(resolve, 5000));

    await browser.close();

    if (!apiUrl) {
      console.error('[TJ] 未找到 API URL，可能页面结构变了');
      return [];
    }

    console.log(`✅ 捕获到 TJ API URL: ${apiUrl}`);

    // 请求 API 获取数据
    const { data } = await axios.get(apiUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
      },
    });

    // 解析 API 返回数据
    if (data && data.trc && data.trc.items) {
      for (const item of data.trc.items) {
        const title = item.name || '';
        const link = item.url || '';
        const date = new Date(); // API 没有时间，用当前时间代替

        if (title && link && isWithinTimeWindow(date.toISOString())) {
          articles.push({
            title,
            link,
            date,
            source: 'tj',
          });
        }
      }
    }
  } catch (error) {
    console.error('[TJ] 抓取失败:', error);
  }

  return articles;
}