// ✅ 只保留这类 import

// 只从 utils/types.ts 引入类型，不再在本文件里声明接口
import type { AnyScraperConfig } from './utils/types';

/*** 约定：
 * A 类（稳定）   ：列表页就有时间 --> 不需要细页，或仅缺失时补抓
 * B 类（半稳定） ：偶尔没时间   --> fetchWhenNoDate=true（默认）
 * C 类（必须细页）：列表页没时间 --> alwaysFetch=true
 */
export const SCRAPER_CONFIGS: AnyScraperConfig[] = [
  // ------ City of Saint John ------
  {
    id: 'city-sj',
    name: 'City of Saint John',
    enabled: true,
    kind: 'html',
    url: 'https://saintjohn.ca/en/news-and-notices',
    baseUrl: 'https://saintjohn.ca',
    selectors: {
      listItem:
        '.views-element-container .views-row article, article.node.article--teaser, .views-row',
      title: '.teaser-card .mid-card span, h2 a, a',
      link: 'a.node-link, a',
      date: '.teaser-card .mid-card .date, time, .date',
      dateAttr: 'datetime',
    },
    linkIncludes: ['/en/news-and-notices/'],
    linkExcludes: [
      '/news-notices-rss',
      '/subscribe-email-notifications',
      '/category/',
      '/tag/',
      '/page/',
      '/en/search',
    ],
    titleExcludes: ['Subscribe', 'RSS', 'Search'],
    detail: { fetchWhenNoDate: true, alwaysFetch: false, concurrency: 3 },
    dateFormats: [
      'MMMM D, YYYY',
      'MMM D, YYYY',
      'MMMM D, YYYY h:mm A',
      'MMM D, YYYY h:mm A',
    ],
    areaTags: ['saint john'],
    maxItems: 20,
  },

// ---- Town of Rothesay ----
{
  id: 'rothesay',
  name: 'Town of Rothesay',
  enabled: true,
  kind: 'html',
  url: 'https://www.rothesay.ca/news/',
  baseUrl: 'https://www.rothesay.ca',

  // 列表结构：
  // <h2><a href="具体文章链接">标题</a></h2>
  // <p class="published">November 6th, 2025</p>
  // <div class="entry">...</div>
  selectors: {
    // 只把每条新闻的 <h2> 当成一个 list item
    listItem: '#content .entry-content h2',
    title: 'a',   // 标题就是 h2 里的 a
    link: 'a',    // 链接也是同一个 a
    // 列表页虽然有日期 <p class="published">，但不在这里取，
    // 统一交给详情页去解析，所以 date 不填
    // date: 'p.published',
    // dateAttr: null,
  },

  // ⚠️ 重点：不要再用 linkIncludes 了
  // linkIncludes: ['/news/'],  // ← 把这行删掉 / 注释掉

  // 也可以先不做任何 excludes，等后面实际跑起来再看是否需要
  // linkExcludes: ['/events/', '/page/'],
  // titleExcludes: ['Events', 'Contact', 'Council', 'Archives', 'Home'],

  // 我们依然用详情页补日期，确保 date 有值
  detail: {
    fetchWhenNoDate: true,
    alwaysFetch: true,
    concurrency: 3,
  },

  areaTags: ['rothesay'],
  maxItems: 20,
},

   // ---- Town of Quispamsis ----
  {
    id: 'quispamsis',
    name: 'Town of Quispamsis',
    enabled: true,
    kind: 'html',
    url: 'https://www.quispamsis.ca/news/',
    baseUrl: 'https://www.quispamsis.ca',

    // 列表页：https://www.quispamsis.ca/news/
    // 里面所有新闻链接都是 /news-and-notices/posts/...
    selectors: {
      // 尽量宽一点，用统一过滤来收窄
      listItem: 'article, .post, .news-item, li',
      title: 'a, h2 a',
      link: 'a',
      // 列表上不指望拿日期，统一交给详情页补
      // date: undefined,
      // dateAttr: undefined,
    },

    // 只保留真正的新闻文章链接
    linkIncludes: ['/news-and-notices/posts/'],
    // 先不排除任何东西，有问题再加
    // linkExcludes: ['/category/', '/tag/', '/page/'],

    // 这些词大概率是菜单 / 页面上的，不是新闻标题
    titleExcludes: ['Home', 'Contact', 'Council', 'Parks'],

    // 必须抓详情页拿日期，因为详情里有 .gs-news-details-date
    detail: { fetchWhenNoDate: true, alwaysFetch: true, concurrency: 3 },

    // 常见英文日期格式（可选）
    dateFormats: ['MMMM D, YYYY', 'MMM D, YYYY', 'MMMM D, YYYY h:mm A', 'MMM D, YYYY h:mm A'],

    areaTags: ['quispamsis'],
    maxItems: 20,
  },

    // NB Power - News (HTML)
  {
    id: 'nb-power',
    name: 'NB Power (News)',
    enabled: true,
    kind: 'html',
    // 列表页：只有标题 + 日期，结构很干净
    url: 'https://www.nbpower.com/en/about-us/news-media-centre/news',
    baseUrl: 'https://www.nbpower.com',

    // 列表结构：
    // <div class="newsItem">
    //   <a href="/en/about-us/news-media-centre/news/2025/...">标题</a>
    //   <span class="date">2025-07-14</span>
    // </div>
    selectors: {
      listItem: '.newsItem',
      title: 'a',
      link: 'a',
      date: '.date',
      // dateAttr 不用写，直接用文本就行
    },

    // 目前 .newsItem 里面只有新闻链接，可以不加 includes / excludes
    // linkIncludes: ['/en/about-us/news-media-centre/news/'],
    // linkExcludes: [],
    // titleExcludes: [],

    areaTags: ['new brunswick', 'power'],
    maxItems: 20,

    // 列表已经有日期了，一般不用进详情页
    detail: {
      fetchWhenNoDate: true,   // 如果以后有哪条没日期，可以补抓
      alwaysFetch: false,
      concurrency: 3,
    },
  },
  
  {
  id: 'vitalite',
  name: 'Vitalité Health Network',
  enabled: true,
  kind: 'html',

  url: 'https://www.vitalitenb.ca/en/news',
  baseUrl: 'https://www.vitalitenb.ca',

  selectors: {
    listItem: '#flexicontent .fc-item-block-standard-wrapper, .fc-item-block-standard-wrapper',
    title: 'h3 a, a',
    link: 'h3 a, a',
    date: '.fc_date, time',
    dateAttr: 'datetime',
  },

  // Vitalité 的新闻链接格式都是 /en/news/something
  linkIncludes: ['/en/news/'],

  // 避免误抓顶部的 Careers / Contact / Home 等链接
  titleExcludes: ['Home', 'Careers', 'Contact'],

  // 日期在列表就有，一般无需详情页
  detail: {
    fetchWhenNoDate: true,
    alwaysFetch: false,
    concurrency: 3,
  },

  areaTags: ['health', 'hospital', 'vitalite'],
  maxItems: 20,
},

  // Country 94 News
  {
    id: 'country94',
    name: 'Country 94 (News)',
    enabled: true,
    kind: 'html',
    url: 'https://www.country94.ca/category/news/',
    baseUrl: 'https://www.country94.ca',
    selectors: {
      listItem: '.posts.items-wrapper .sc-list-item',
      title: '.sc-list-title',
      link: 'a', // listItem 本身是 <a>，link 兜底从自身 href 取
      date: '.sc-time',
      dateAttr: null,
    },
  areaTags: ['saint john'],
  maxItems: 20,
  detail: {
    fetchWhenNoDate: true,
    alwaysFetch: false,
    concurrency: 3,
  },
},

  // CTV Atlantic — New Brunswick
  {
    id: 'ctv-nb',
    name: 'CTV Atlantic (New Brunswick)',
    enabled: true,
    kind: 'html',
    url: 'https://atlantic.ctvnews.ca/new-brunswick',
    baseUrl: 'https://atlantic.ctvnews.ca',
    selectors: {
      // 页面有 hero 与列表，均使用 <article>
      listItem: 'article.b-media-item, article',
      title: 'h2 a.c-link',
      link: 'h2 a.c-link',
      date: 'time.c-date',
      dateAttr: 'datetime',
    },
    // 仅保留 NB 文章链接（两种前缀都包含）
    linkIncludes: ['/atlantic/new-brunswick/article/', '/new-brunswick/article/'],
    areaTags: ['new brunswick'],
    maxItems: 20,
    detail: {
      fetchWhenNoDate: true,
      alwaysFetch: false,
      concurrency: 3,
    },
  },

  // Government of NB — News Releases (EN)
  {
    id: 'gnb-news-en',
    name: 'Government of NB News (EN)',
    enabled: true,
    kind: 'rss',
    url: 'https://www2.gnb.ca/content/gnb/en/news/recent_news/_jcr_content/mainContent_par/newslist.rss1.html',
    areaTags: ['new brunswick', 'government'],
    maxItems: 30,
  },

  // UNB Newsroom
  {
    id: 'unb-news',
    name: 'UNB Newsroom',
    enabled: true,
    kind: 'html',
    url: 'https://blogs.unb.ca/newsroom/',
    baseUrl: 'https://blogs.unb.ca/newsroom/',
    selectors: {
      // 列表页每篇文章标题是一个 h2 > a
      listItem: 'h2',
      title: 'a',
      link: 'a',
      // 列表页的日期示例：“Posted: Nov 21, 2025”
      date: 'p:contains("Posted")',
      dateAttr: null,
    },
    linkIncludes: ['/newsroom/'],
    areaTags: ['unb', 'schools'],
    maxItems: 20,
    detail: {
      fetchWhenNoDate: true,
      alwaysFetch: true, // 详情页兜底解析 “Posted:” 日期
      concurrency: 3,
    },
  },

  // Horizon Health — News Releases
  {
    id: 'horizon-health',
    name: 'Horizon Health News Releases',
    enabled: true,
    kind: 'html',
    url: 'https://horizonnb.ca/category/news-releases/',
    baseUrl: 'https://horizonnb.ca',
    selectors: {
      listItem: 'article.post',
      title: 'h2.entry-title a',
      link: 'h2.entry-title a',
      date: 'time.entry-date.published',
      dateAttr: 'datetime',
    },
    linkIncludes: ['/news-releases/'],
    areaTags: ['health', 'horizon'],
    maxItems: 20,
    detail: {
      fetchWhenNoDate: true,
      alwaysFetch: false,
      concurrency: 3,
    },
  },

  // RCMP New Brunswick — RSS（Drupal feed）
  {
    id: 'rcmp-nb',
    name: 'RCMP New Brunswick',
    enabled: true,
    kind: 'html', // 实际用自定义爬虫（DataTables 动态），测试入口会特判 id
    url: 'https://rcmp.ca/en/nb/news',
    areaTags: ['rcmp', 'new brunswick'],
    maxItems: 30,
  },



    // DSFS（法语学区）— 直接从列表页拿标题 + 日期
  {
    id: 'dsfs',
    name: 'District scolaire francophone Sud',
    enabled: true,
    kind: 'html',
    url: 'https://francophonesud.nbed.nb.ca/district-scolaire/nouvelles',
    baseUrl: 'https://francophonesud.nbed.nb.ca',
    headers: { 'Accept-Language': 'fr-CA,fr;q=0.8,en;q=0.5' },

    // 每条新闻是一个 .com-content-category-blog__item 卡片
    selectors: {
      // 一条新闻对应一个卡片容器
      listItem:
        '.com-content-category-blog__items .com-content-category-blog__item, ' +
        '.com-content-category-blog .com-content-category-blog__item',

      // 标题在 page-header > h2[itemprop=name] > a[itemprop=url]
      title:
        'div.page-header h2[itemprop="name"] a[itemprop="url"], ' +
        'div.page-header h2[itemprop="name"] a, ' +
        'div.page-header h2 a',

      // 链接和标题用同一个 <a>，避免选到底部 “Lire la suite”
      link:
        'div.page-header h2[itemprop="name"] a[itemprop="url"], ' +
        'div.page-header h2[itemprop="name"] a, ' +
        'div.page-header h2 a',

      // 日期在 <dd class="create"><time datetime="...">
      date:
        'dd.create time[itemprop="dateCreated"], ' +
        'dd.create time, ' +
        'time[itemprop="dateCreated"]',
      dateAttr: 'datetime',
    },

    // 只保留真正新闻详情页
    linkIncludes: ['/district-scolaire/nouvelles/'],

    // 过滤掉顶部导航等非新闻链接
    titleExcludes: ['Accueil', 'Emplois', 'Communications', 'Nous joindre', 'EN'],

    areaTags: ['schools', 'fr'],
    maxItems: 20,

    // 列表一般就有时间；为稳妥保留 “缺日期时再抓详情”的逻辑
    detail: {
      fetchWhenNoDate: true,
      alwaysFetch: false,
      concurrency: 3,
    },
  },
];

// Programmer notes (future sources to consider, no config yet):
// - Fredericton news: https://www.fredericton.ca/en/news
// - City of Moncton news: https://www.moncton.ca/news
// - Dieppe news: https://www.dieppe.ca/en/news-and-events/news.aspx
