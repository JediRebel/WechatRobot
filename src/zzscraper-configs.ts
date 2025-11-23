// 集中列出所有“通用/ RSS”可抓的站点配置
export type SourceKind = 'html' | 'rss';

export interface HtmlSelectors {
  listItem: string;        // 列表项选择器
  title: string;           // 相对列表项的标题选择器
  link: string;            // 相对列表项的链接选择器
  date?: string;           // 可选：相对列表项的日期选择器
  dateAttr?: string;       // 可选：日期从哪个属性取（如 datetime）
}

export interface ScraperConfig {
  id: string;
  name: string;
  enabled: boolean;
  kind: SourceKind;
  url: string;
  baseUrl?: string;
  selectors?: HtmlSelectors;
  areaTags?: string[];
  maxItems?: number;
  headers?: Record<string, string>;
  /** 额外过滤：仅保留链接中包含任一片段的条目 */
  linkIncludes?: string[];
  /** 额外过滤：剔除标题包含任一关键词的条目（如“Accueil”） */
  titleExcludes?: string[];
  /** 当 kind==='rss' 时，按顺序尝试的候选 RSS 地址 */
  rssCandidates?: string[];
}

export const SCRAPER_CONFIGS: ScraperConfig[] = [
  {
    id: 'city-sj',
    name: 'City of Saint John',
    enabled: true,
    kind: 'html',
    url: 'https://saintjohn.ca/en/news',
    baseUrl: 'https://saintjohn.ca',
    selectors: {
      listItem: '.view-content .views-row, article, li',
      title: 'a, h3 a',
      link: 'a',
      date: 'time, .date, .created',
      dateAttr: 'datetime',
    },
    areaTags: ['saint john'],
    maxItems: 20,
  },
  {
    id: 'rothesay',
    name: 'Town of Rothesay',
    enabled: true,
    kind: 'html',
    url: 'https://www.rothesay.ca/news/',
    baseUrl: 'https://www.rothesay.ca',
    selectors: {
      listItem: 'article, .post, .news-item, li',
      title: 'a, h2 a',
      link: 'a',
      date: 'time, .date, .post-date',
      dateAttr: 'datetime',
    },
    areaTags: ['rothesay'],
    maxItems: 20,
  },
  {
    id: 'quispamsis',
    name: 'Town of Quispamsis',
    enabled: true,
    kind: 'html',
    url: 'https://www.quispamsis.ca/news/',
    baseUrl: 'https://www.quispamsis.ca',
    selectors: {
      listItem: 'article, .post, .news-item, li',
      title: 'a, h2 a',
      link: 'a',
      date: 'time, .date, .post-date',
      dateAttr: 'datetime',
    },
    areaTags: ['quispamsis'],
    maxItems: 20,
  },
  {
    id: 'nb-power',
    name: 'NB Power (RSS)',
    enabled: true,
    kind: 'rss',
    url: 'https://www.nbpower.com/en/about-us/news-feed?format=rss',
    areaTags: ['new brunswick', 'power'],
    maxItems: 20,
  },
  {
    id: 'vitalite',
    name: 'Vitalité Health Network',
    enabled: true,
    kind: 'html',
    url: 'https://www.vitalitenb.ca/en/news',
    baseUrl: 'https://www.vitalitenb.ca',
    selectors: {
      listItem: '.view-content .views-row, article, li',
      title: 'a, h2 a, h3 a',
      link: 'a',
      date: 'time, .date',
      dateAttr: 'datetime',
    },
    areaTags: ['health', 'new brunswick'],
    maxItems: 20,
  },

  /** ✅ DSFS（法语学区）：改用 RSS，并提供多个候选 RSS 地址 */
  {
    id: 'dsfs',
    name: 'District scolaire francophone Sud',
    enabled: true,
    kind: 'rss',
    url: 'https://francophonesud.nbed.nb.ca/district-scolaire/nouvelles?format=feed&type=rss',
    rssCandidates: [
      'https://francophonesud.nbed.nb.ca/district-scolaire/nouvelles?format=feed&type=rss',
      'https://francophonesud.nbed.nb.ca/communications-3?format=feed&type=rss',
      'https://francophonesud.nbed.nb.ca/?format=feed&type=rss',
    ],
    areaTags: ['schools', 'fr'],
    maxItems: 20,
    headers: { 'Accept-Language': 'fr-CA,fr;q=0.8,en;q=0.5' },
  },
];