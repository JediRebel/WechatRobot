// src/test-dsfs.ts
import { scrape } from './scrapers/';

async function main() {
  console.log('🔍 测试 DSFS 爬虫');
  const items = await scrape();
  console.log(`✅ 抓到 ${items.length} 条：`);
  console.log(items.slice(0, 10));
}
main();