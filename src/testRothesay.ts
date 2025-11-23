import { SCRAPER_CONFIGS } from './scraper-configs';
import { scrapeByConfig } from '../src/scrapers/genericScraper';
import type { HtmlScraperConfig } from '../src/scrapers/genericScraper'; // ✅ 引入“HTML 专用”类型

async function testRothesay() {
  // 只取 kind === 'html' 的 Rothesay 配置，并窄化为 HtmlScraperConfig
  const cfg = SCRAPER_CONFIGS.find(
    c => c.id === 'rothesay' && c.kind === 'html'
  ) as HtmlScraperConfig | undefined;

  if (!cfg) {
    console.error('找不到 Rothesay 的 HTML 配置');
    return;
  }

  try {
    const items = await scrapeByConfig(cfg); // ✅ 现在类型匹配
    console.log('抓取到的条目数：', items.length);
    for (const item of items) {
      console.log(`[${item.date}] ${item.title} -> ${item.link}`);
    }
  } catch (err) {
    console.error('抓取出错:', err);
  }
}

testRothesay();