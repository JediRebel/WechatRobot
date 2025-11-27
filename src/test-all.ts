// src/test-all.ts
/* eslint-disable no-console */

import minimist from 'minimist';
import Parser from 'rss-parser';
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
import { scrape as scrapeRcmp } from './scrapers/rcmp';
import fs from 'fs';
import path from 'path';

// ========== CLI 参数 ==========
const argv = minimist(process.argv.slice(2), {
  boolean: ['debug', 'ignoreWindow', 'all'],
  string: ['only', 'windowHours', 'show', 'json'],
  alias: {
    d: 'debug',
    i: 'ignoreWindow',
    a: 'all',
    o: 'only',
  },
  default: {
    debug: false,
    ignoreWindow: false,
    all: false,
    show: '3',
  },
});

const showLimit = Number(argv.show) || 3;
const jsonPath = (argv.json || '').toString().trim();
const baseOpts: ScrapeOptions = {
  debug: !!argv.debug,
  ignoreWindow: !!argv.ignoreWindow,
  windowHours: argv.windowHours ? Number(argv.windowHours) : undefined,
};

const onlyId = (argv.only || '').toString().trim();
const testAll = !!argv.all || !onlyId;

let configsToTest: AnyScraperConfig[];
if (onlyId) {
  configsToTest = SCRAPER_CONFIGS.filter((c) => c.id === onlyId);
} else if (testAll) {
  configsToTest = SCRAPER_CONFIGS;
} else {
  configsToTest = SCRAPER_CONFIGS;
}

console.log(
  '参数：debug=%s, ignoreWindow=%s, windowHours=%s, show=%s, only=%s, all=%s\n',
  baseOpts.debug,
  baseOpts.ignoreWindow,
  baseOpts.windowHours ?? '(default)',
  showLimit,
  onlyId || '(none)',
  testAll,
);

if (!configsToTest.length) {
  console.error('❌ 没有找到要测试的配置（检查 id 是否正确）');
  process.exit(1);
}

const rssParser = new Parser();
const aggregated: Array<{
  sourceId: string;
  name: string;
  items: { title: string; link: string; dateISO?: string; source: string }[];
}> = [];

async function run() {
  for (const config of configsToTest) {
    if (!config.enabled) {
      console.log(`⏭️  [${config.id}] ${config.name} (disabled)`);
      continue;
    }

    try {
      if (isHtmlConfig(config)) {
        if (config.id === 'rcmp-nb') {
          await testRcmp(baseOpts);
        } else {
          await testHtml(config, baseOpts);
        }
      } else if (isRssConfig(config)) {
        await testRss(config, baseOpts);
      } else {
        console.log(`❓ [${(config as any).id}] Unknown kind: ${(config as any).kind}`);
      }
    } catch (err) {
      console.error(`❌ [${(config as any).id}] error:`, (err as Error).message);
    }

    console.log(); // 每个配置之间空行
  }

  console.log('🏁 全部测试完成。');
  if (jsonPath) {
    const out = aggregated;
    const outFile = jsonPath.startsWith('.') || jsonPath.startsWith('/')
      ? jsonPath
      : path.join(process.cwd(), jsonPath);
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, JSON.stringify(out, null, 2), 'utf8');
    console.log(`📝 Aggregated JSON saved to ${outFile}`);
  }
  process.exit(0);
}

// ========== HTML ==========
async function testHtml(config: HtmlScraperConfig, opts: ScrapeOptions) {
  console.log(`🔍 正在爬取: [${config.id}] ${config.name}`);
  const items = await scrapeHtml(config, opts);
  const show = Math.min(showLimit, items.length);
  console.log(`✅ [${config.id}] got ${items.length} items. Showing first ${show}:`);
  console.dir(items.slice(0, show), { depth: null });
  aggregated.push({
    sourceId: config.id,
    name: config.name,
    items: items.map((it) => ({
      title: it.title,
      link: it.link,
      dateISO: it.date ? it.date.toISOString() : undefined,
      source: it.source,
    })),
  });
}

// ========== RSS ==========
async function testRss(config: RssScraperConfig, _opts: ScrapeOptions) {
  console.log(`🔍 正在爬取 RSS: [${config.id}] ${config.name}`);
  console.log(`[${config.id}] 拉取 RSS: ${config.url}`);
  const parser = config.headers ? new Parser({ headers: config.headers }) : rssParser;

  try {
    const feed = await parser.parseURL(config.url);
    let items = feed.items || [];

    // 时间窗过滤（若指定 windowHours 且未忽略时间窗）
    if (!_opts.ignoreWindow && _opts.windowHours) {
      const now = Date.now();
      const windowMs = _opts.windowHours * 3600 * 1000;
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

    const show = Math.min(showLimit, items.length);
    console.log(`✅ [${config.id}] got ${items.length} items. Showing first ${show}:`);
    console.dir(
      items.slice(0, show).map((it) => ({
        title: it.title,
        link: it.link,
        pubDate: it.pubDate,
      })),
      { depth: null },
    );

    aggregated.push({
      sourceId: config.id,
      name: config.name,
      items: (items || []).map((it) => ({
        title: it.title || '',
        link: it.link || '',
        dateISO: it.isoDate || it.pubDate,
        source: config.id,
      })),
    });
  } catch (e) {
    console.error(`❌ [${config.id}] error:`, (e as Error).message);
  }
}

// ========== RCMP 特殊 ==========
async function testRcmp(opts: ScrapeOptions) {
  console.log('🔍 Testing RCMP NB (custom dynamic scraper)');
  const items = await scrapeRcmp(opts);
  const show = Math.min(showLimit, items.length);
  console.log(`✅ [rcmp-nb] got ${items.length} items. Showing first ${show}:`);
  console.dir(items.slice(0, show), { depth: null });
  aggregated.push({
    sourceId: 'rcmp-nb',
    name: 'RCMP New Brunswick',
    items: items.map((it) => ({
      title: it.title,
      link: it.link,
      dateISO: it.date ? it.date.toISOString() : undefined,
      source: it.source,
    })),
  });
}

void run();
