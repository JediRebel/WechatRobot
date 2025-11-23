// src/test-scrapers.ts
/* eslint-disable no-console */

import minimist from 'minimist';
import { SCRAPER_CONFIGS } from './scraper-configs';
import {
  AnyScraperConfig,
  HtmlScraperConfig,
  RssScraperConfig,
  isHtmlConfig,
  isRssConfig,
  ScrapeOptions,
} from './utils/types';
import { scrapeByConfig as scrapeHtml } from './scrapers/genericScraper';
import Parser from 'rss-parser';

// ========== 解析命令行参数 ==========
const argv = minimist(process.argv.slice(2), {
  boolean: ['debug', 'all', 'ignoreWindow'],
  string: ['only', 'windowHours'],
  alias: {
    d: 'debug',
    a: 'all',
    o: 'only',
    // 可以用 -i 代表 --ignoreWindow（可选）
    i: 'ignoreWindow',
  },
  default: {
    debug: false,
    all: false,
    ignoreWindow: false,
  },
});

// 统一给 HTML / RSS 使用的 options
const baseOpts: ScrapeOptions = {
  debug: !!argv.debug,
  // 只要传了 --ignoreWindow 或 --all，都跳过时间窗口
  ignoreWindow: !!argv.ignoreWindow || !!argv.all,
  windowHours: argv.windowHours ? Number(argv.windowHours) : undefined,
};

const testAll = !!argv.all;
const onlyId = (argv.only || '').toString().trim();

console.log(
  '参数：debug=%s, ignoreWindow=%s, windowHours=%s, only=%s, all=%s\n',
  baseOpts.debug,
  baseOpts.ignoreWindow,
  baseOpts.windowHours ?? '(default)',
  onlyId || '(none)',
  testAll,
);

// ========== 选择要测试的配置 ==========
let configsToTest: AnyScraperConfig[];

if (onlyId) {
  configsToTest = SCRAPER_CONFIGS.filter((c: AnyScraperConfig) => c.id === onlyId);
} else if (testAll) {
  configsToTest = SCRAPER_CONFIGS as AnyScraperConfig[];
} else {
  // 默认测试全部
  configsToTest = SCRAPER_CONFIGS as AnyScraperConfig[];
}

if (!configsToTest.length) {
  console.error('❌ 没有找到要测试的配置（检查 id 是否正确）');
  process.exit(1);
}

console.log(`将测试 ${configsToTest.length} 个爬虫配置\n`);

const rssParser = new Parser();

// ========== 主测试流程 ==========
(async () => {
  for (const config of configsToTest) {
    try {
      if (isHtmlConfig(config)) {
        await testHtml(config, baseOpts);
      } else if (isRssConfig(config)) {
        await testRss(config, baseOpts);
      } else {
        console.log(
          `❓ [${(config as any).id}] Unknown kind: ${(config as any).kind}`,
        );
      }
    } catch (err) {
      console.error(
        `❌ [${(config as any).id}] error:`,
        (err as Error).message,
      );
    }
    console.log(); // 每个配置之间空一行
  }

  console.log('🏁 全部测试完成。');
  process.exit(0);
})();

// ========== HTML 爬虫测试 ==========
async function testHtml(config: HtmlScraperConfig, opts: ScrapeOptions) {
  console.log(`🔍 Testing HTML source: [${config.id}] ${config.name}`);

  const items = await scrapeHtml(config, opts);

  console.log(
    `✅ [${config.id}] got ${items.length} items. Showing first 3:`,
  );
  console.dir(items.slice(0, 3), { depth: null });
}

// ========== RSS 爬虫测试 ==========
async function testRss(config: RssScraperConfig, opts: ScrapeOptions) {
  console.log(`🔍 Testing RSS source: [${config.id}] ${config.name}`);
  console.log(`[${config.id}] Fetch RSS: ${config.url}`);

  try {
    const feed = await rssParser.parseURL(config.url);

    let items = feed.items || [];

    // 如果没忽略时间窗、且配置了 windowHours，就按 pubDate 简单过滤一遍
    if (!opts.ignoreWindow && opts.windowHours) {
      const now = Date.now();
      const windowMs = opts.windowHours * 3600 * 1000;

      items = items.filter((it) => {
        const d = it.isoDate || it.pubDate;
        if (!d) return false;
        const t = Date.parse(d);
        if (Number.isNaN(t)) return false;
        return now - t <= windowMs;
      });
    }

    if (config.maxItems && items.length > config.maxItems) {
      items = items.slice(0, config.maxItems);
    }

    console.log(
      `✅ [${config.id}] got ${items.length} items. Showing first 3:`,
    );
    console.dir(
      items.slice(0, 3).map((it) => ({
        title: it.title,
        link: it.link,
        pubDate: it.pubDate,
      })),
      { depth: null },
    );
  } catch (e) {
    console.error(
      `❌ [${config.id}] error:`,
      (e as Error).message,
    );
  }
}