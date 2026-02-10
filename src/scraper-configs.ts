// ✅ 只保留这类 import

// 只从 utils/types.ts 引入类型，不再在本文件里声明接口
import type { AnyScraperConfig } from './utils/types';

/*** 约定：
 * A 类（稳定）   ：列表页就有时间 --> 不需要细页，或仅缺失时补抓
 * B 类（半稳定） ：偶尔没时间   --> fetchWhenNoDate=true（默认）
 * C 类（必须细页）：列表页没时间 --> alwaysFetch=true
 */
export const SCRAPER_CONFIGS: AnyScraperConfig[] = [
 
  // ------ City of Saint John (精准修正版) ------
  {
    id: 'city-sj',
    name: 'City of Saint John',
    enabled: true,
    kind: 'html',
    url: 'https://saintjohn.ca/en/news-and-notices',
    baseUrl: 'https://saintjohn.ca',
    
    selectors: {
      // ✅ 1. 精准定位：源码显示主新闻卡片都是 <article class="article--teaser">
      // 用这个做选择器，绝对不会误伤侧边栏
      listItem: 'article.article--teaser',
      
      // ✅ 2. 标题：你的源码显示标题就在 .mid-card 下的 span 里
      title: '.mid-card span',
      
      // ✅ 3. 链接：源码显示链接是一个类名为 node-link 的空链接覆盖在卡片上
      link: 'a.node-link',
      
      // ✅ 4. 日期：源码显示日期在 .date 类里
      date: '.date',
      
      // 🚨 5. 关键修复：指定详情页正文容器 .article__body
      // 这能让爬虫抓到里面的 <ul> (Cliff Street 那些列表)，而不仅是 <p>
      content: '.article__body',
    },

    // 保持你原有的过滤逻辑
    linkIncludes: ['/en/news-and-notices/'],
    linkExcludes: [
      '/news-notices-rss',
      '/subscribe-email-notifications',
      '/en/search',
    ],
    titleExcludes: ['Subscribe', 'RSS', 'Search'],
    
    areaTags: ['saint john', 'municipal'],
    maxItems: 20,
    
    detail: {
      fetchWhenNoDate: true,
      // 🚨 必须设为 true：强制进入详情页，这样上面的 content 选择器才会生效
      alwaysFetch: true, 
      concurrency: 3,
    },
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

 // ---- Town of Quispamsis (修复版) ----
  {
    id: 'quispamsis',
    name: 'Town of Quispamsis',
    enabled: true,
    kind: 'html',
    url: 'https://www.quispamsis.ca/news/',
    baseUrl: 'https://www.quispamsis.ca',

    selectors: {
      // 1. 精准定位列表项：使用截图中的类名 .gs-feed-list-item
      listItem: '.gs-feed-list-item',
      
      // 2. 精准定位标题：只抓取带有 .gs-feed-list-title 类的链接
      // 这样就彻底排除了分类、作者等其他杂项文字
      title: 'a.gs-feed-list-title',
      link: 'a.gs-feed-list-title',
      
      // 3. 列表页其实有日期，在 .gs-feed-list-author-date 里
      // 格式如 "By Town of Quispamsis - Jan 27, 2026"
      // 我们的爬虫通常能从这种混合文本里识别出日期，建议填上
      date: '.gs-feed-list-author-date',
    },

    // 过滤规则保持不变
    linkIncludes: ['/news-and-notices/posts/'],
    titleExcludes: ['Home', 'Contact', 'Council', 'Parks'],

    // 依然开启详情页抓取以获取正文
    detail: { 
      fetchWhenNoDate: true, 
      alwaysFetch: true, 
      concurrency: 3 
    },
    
    dateFormats: ['MMMM D, YYYY', 'MMM D, YYYY'],
    areaTags: ['quispamsis'],
    maxItems: 20,
  },

// ------ NB Power (结构修正版) ------
  {
    id: 'nb-power',
    name: 'NB Power (News)',
    enabled: true,
    kind: 'html',
    url: 'https://www.nbpower.com/en/about-us/news-media-centre/news/',
    baseUrl: 'https://www.nbpower.com',
    
    headers: {
      'Cookie': 'Lang=en', 
      'Accept-Language': 'en-US,en;q=0.9'
    },

    selectors: {
      // 🚨 修正1：根据源代码，这里必须是 .newsItem
      listItem: '.newsItem', 
      
      // 标题和链接都在 div 下的 a 标签里
      title: 'a',
      link: 'a',
      
      // 🚨 修正2：有了正确的 listItem，span.date 就能被找到了
      date: 'span.date', 
      
      content: '.col.span_3_of_4.mobileMargin, .mainContent', 
    },

    linkIncludes: ['/news/20'], 
    linkExcludes: ['/fr/', 'contact-us'], 
    
    areaTags: ['utility', 'power'],
    maxItems: 20,
    detail: {
      fetchWhenNoDate: true,
      alwaysFetch: true, 
      concurrency: 3,
    },
  },

  // Vitalité Health Network
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

// ------ Country 94 (Redirects to Your Saint John) ------
  {
    id: 'country94',
    name: 'Country 94 (Your Saint John)',
    enabled: true,
    kind: 'html',
    // 🚨 修正 1: 更新为实际的新闻列表 URL
    url: 'https://yoursaintjohn.ca/news/',
    baseUrl: 'https://yoursaintjohn.ca',

    selectors: {
      // 🚨 修正 2: 根据截图 image_6d7d19.jpg，列表项是 article 标签
      listItem: 'article.type-post, article.category-news',
      
      // 标题在 h2.tbp_title a
      title: 'h2.tbp_title a',
      link: 'h2.tbp_title a',
      
      // 列表页无日期，设为 undefined
      date: undefined,

      // 🚨 修正 3: 根据你提供的 HTML 片段，正文在 .tb_text_wrap
      content: '.tb_text_wrap',
    },

    areaTags: ['saint john', 'news'],
    maxItems: 20,

    detail: {
      fetchWhenNoDate: true,
      // 🚨 修正 4: 列表页没日期，必须强制抓取详情页
      alwaysFetch: true, 
      concurrency: 3,
    },
  },

// ------ CTV Atlantic — New Brunswick ------
  {
    id: 'ctv-nb',
    name: 'CTV Atlantic (New Brunswick)',
    enabled: true,
    kind: 'html',
    url: 'https://atlantic.ctvnews.ca/new-brunswick',
    baseUrl: 'https://atlantic.ctvnews.ca',
    selectors: {
      listItem: 'article.b-media-item, article',
      title: 'h2 a.c-link',
      link: 'h2 a.c-link',
      date: 'time.c-date',
      dateAttr: 'datetime',
      // 这个其实会被上面的 JSON 逻辑截胡，但留着也没事
      content: 'article', 
    },
    linkIncludes: ['/atlantic/new-brunswick/article/', '/new-brunswick/article/'],
    areaTags: ['new brunswick'],
    maxItems: 20,
    detail: {
      fetchWhenNoDate: true,
      alwaysFetch: true, // 必须开启
      concurrency: 3,
    },
  },

// ------ GNB News (精准碎片抓取版) ------
  {
    id: 'gnb-news-en',
    name: 'Government of NB News (EN)',
    enabled: true,
    kind: 'html',
    url: 'https://www2.gnb.ca/content/gnb/en/news/recent_news/_jcr_content/mainContent_par/newslist.html',
    baseUrl: 'https://www2.gnb.ca',
    selectors: {
      listItem: 'li',
      title: 'h3 a',
      link: 'h3 a',
      date: '.post_date',
      content: '.articleBody', // 或 .articleBody, .text
    },
    linkIncludes: ['/news/news_release.'], 
    areaTags: ['provincial', 'government'],
    maxItems: 20,
    detail: {
      fetchWhenNoDate: true,
      alwaysFetch: true, 
      concurrency: 3,
    },
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

 // ------ Horizon Health ------
  {
    id: 'horizon-health',
    name: 'Horizon Health News Releases',
    enabled: true,
    kind: 'html',
    url: 'https://horizonnb.ca/news/',
    baseUrl: 'https://horizonnb.ca',
    
    selectors: {
      // 列表项：根据源码是 div.block-news
      listItem: '.block-news',
      
      // 标题：p.text-area__title
      title: '.text-area__title',
      
      // 链接：整个块被 a 标签包裹，或者内部有 a
      link: 'a',
      
      // 日期：p.text-area__date
      date: '.text-area__date',
      
      // 🚨 修正：指定详情页正文容器 (根据源码是 .entry-content)
      content: '.entry-content', 
    },

    // 过滤掉非新闻的链接（可选，根据需要调整）
    linkIncludes: ['/news-releases/', '/horizon-stories/'],
    
    areaTags: ['health', 'provincial'],
    maxItems: 20,

    detail: {
      fetchWhenNoDate: true,
      // 🚨 核心修正：必须设为 true，否则因为列表页有日期，爬虫会跳过详情页
      alwaysFetch: true, 
      concurrency: 3,
    },
  },

 
// ------ RCMP New Brunswick (Custom Puppeteer) ------
  {
    id: 'rcmp-nb',
    name: 'RCMP New Brunswick',
    enabled: true,
    kind: 'html', // 这里写 html 只是为了类型兼容，实际上 fetch-all.ts 会拦截它
    url: 'https://rcmp.ca/en/nb/news',
    areaTags: ['rcmp', 'police', 'new brunswick'],
    maxItems: 20,
    // 这里的 selectors 对自定义脚本无效，可以不写
  },

// ------ City of Moncton (内容修复版) ------
  {
    id: 'city-moncton',
    name: 'City of Moncton',
    enabled: true,
    kind: 'html',
    url: 'https://www.moncton.ca/en/news-notices',
    baseUrl: 'https://www.moncton.ca',
    
    selectors: {
      listItem: '.view-content .views-row, article.card',
      title: 'h3.card-title, .views-field-title a',
      link: 'a.stretched-link, .views-field-title a',
      date: '.fst-italic, .views-field-created',
      
      // 🚨 关键修复：
      // 指定抓取 .card-body 下的所有 p (段落) 和 ul (列表)
      // 这样既能避开顶部的 h2 (标题)，又能确保抓到中间的费用清单
      content: '.card-body p, .card-body ul',
    },

    linkIncludes: ['/news-notices/'],
    areaTags: ['moncton'],
    maxItems: 20,
    
    detail: {
      fetchWhenNoDate: true,
      alwaysFetch: true, 
      concurrency: 3,
    },
  },

  // ------ City of Fredericton ------
  {
    id: 'city-fredericton',
    name: 'City of Fredericton',
    enabled: true,
    kind: 'html',
    // 使用你提供的准确 URL
    url: 'https://www.fredericton.ca/your-government/news',
    baseUrl: 'https://www.fredericton.ca',
    selectors: {
      // 截图显示外层 ID 为 view-id-news，锁定这个更精准
      listItem: '.view-id-news .views-row',
      title: '.views-field-title a',
      link: '.views-field-title a',
      // 截图显示日期在 field-date 下的 time 标签
      date: '.views-field-field-date time',
      dateAttr: 'datetime', // 直接取标准 ISO 时间
    },
    // 确保只抓取新闻详情页
    linkIncludes: ['/news/'],
    areaTags: ['fredericton'],
    maxItems: 20,
    detail: {
      fetchWhenNoDate: true,
      alwaysFetch: true, // 开启全抓取以获得长文正文
      concurrency: 3,
    },
  },

  // ------ City of Dieppe ------
  {
    id: 'city-dieppe',
    name: 'City of Dieppe',
    enabled: true,
    kind: 'html',
    // 列表页入口
    url: 'https://www.dieppe.ca/modules/news/en',
    baseUrl: 'https://www.dieppe.ca',
    selectors: {
      // 截图确认：每一行新闻的容器
      listItem: '.blogItem-row, .blogItem',
      // 截图确认：标题类名
      title: 'h2 a.newsTitle',
      link: 'h2 a.newsTitle',
      // 截图确认：日期容器
      date: '.blogPostDate',
      // dateAttr 为空表示取文本内容 ("Posted on ...")
    },
    // 确保只抓取新闻详情页（根据你提供的详情页 URL 特征）
    linkIncludes: ['/nouvelles/', '/news/'],
    // 排除列表页的分页、归档等链接
    linkExcludes: ['/modules/news/'],
    areaTags: ['dieppe'],
    maxItems: 20,
    detail: {
      fetchWhenNoDate: true,
      alwaysFetch: true, // 开启全抓取以获取正文
      concurrency: 3,
    },
  },

 
// ------ Town of Sussex (内容修复版) ------
  {
    id: 'town-sussex',
    name: 'Town of Sussex',
    enabled: true,
    kind: 'html',
    url: 'https://sussex.ca/news/',
    baseUrl: 'https://sussex.ca',
    
    selectors: {
      listItem: 'article',
      title: 'h2 a',
      link: 'h2 a',
      
      // 微调：源码里是双下划线，虽然之前靠 meta 兜底抓到了日期，但改对更好
      date: '.post__meta-date', 
      
      // 🚨 关键修复：指定正文容器
      // 这样能抓到 <ul> (职位列表) 和 <h3> (小标题)
      content: '.post__content',
    },

    linkIncludes: ['/202'], 
    linkExcludes: ['#', 'javascript:', 'mailto:', '/page/', '/category/'],
    
    areaTags: ['sussex'],
    maxItems: 20,
    
    detail: {
      fetchWhenNoDate: true,
      alwaysFetch: true, // 必须开启，以进入详情页抓取完整内容
      concurrency: 3,
    },
  },

 // ------ Town of Saint Andrews (专用 Puppeteer 挂名配置) ------
  {
    id: 'town-saint-andrews', // 🚨 这里的 ID 必须和 fetch-all.ts 里的判断完全一致
    name: 'Town of Saint Andrews',
    enabled: true,           // 开启开关
    kind: 'html',            // 随便填个类型满足 TS
    url: 'https://www.townofsaintandrews.ca/news/',
    areaTags: ['municipal', 'saint andrews'],
  },


  // ------ Anglophone West School District (ASD-W) ------
  {
    id: 'school-asdw',
    name: 'Anglophone West School District',
    enabled: true,
    kind: 'html',
    url: 'https://asdw.nbed.ca/news/',
    baseUrl: 'https://asdw.nbed.ca',
    selectors: {
      // 标准 WordPress 结构
      listItem: 'article, .post, .type-post',
      title: 'h2.entry-title a, h3 a, .entry-title a',
      link: 'h2.entry-title a, h3 a, .entry-title a',
      // 日期通常在 entry-meta 里
      date: 'time.entry-date, .posted-on time, .date',
      dateAttr: 'datetime',
    },
    // 技巧：详情页包含年份（如 /2025/... /2026/...），用 /202 匹配未来十年的新闻
    linkIncludes: ['/202'], 
    // 排除可能的干扰项
    linkExcludes: ['/category/', '/tag/', '/page/'],
    areaTags: ['schools', 'fredericton', 'oromocto', 'woodstock'],
    maxItems: 20,
    detail: {
      fetchWhenNoDate: true,
      alwaysFetch: true, // 开启全抓取以获取全文
      concurrency: 3,
    },
  },

 // ------ DSFS (最终修复版：指定正文位置) ------
  {
    id: 'dsfs',
    name: 'District scolaire francophone Sud',
    enabled: true,
    kind: 'html',
    url: 'https://francophonesud.nbed.nb.ca/district-scolaire/nouvelles',
    baseUrl: 'https://francophonesud.nbed.nb.ca',
    headers: { 'Accept-Language': 'fr-CA,fr;q=0.8,en;q=0.5' },

    selectors: {
      listItem:
        '.com-content-category-blog__items .com-content-category-blog__item, ' +
        '.com-content-category-blog .com-content-category-blog__item',

      title:
        'div.page-header h2[itemprop="name"] a[itemprop="url"], ' +
        'div.page-header h2[itemprop="name"] a, ' +
        'div.page-header h2 a',

      link:
        'div.page-header h2[itemprop="name"] a[itemprop="url"], ' +
        'div.page-header h2[itemprop="name"] a, ' +
        'div.page-header h2 a',

      date:
        'dd.create time[itemprop="dateCreated"], ' +
        'dd.create time, ' +
        'time[itemprop="dateCreated"]',
      dateAttr: 'datetime',
      
      // 🚨 新增：根据截图 image_785afe.jpg 指定正文容器
      content: '.com-content-article__body, [itemprop="articleBody"]',
    },

    linkIncludes: ['/district-scolaire/nouvelles/'],
    titleExcludes: ['Accueil', 'Emplois', 'Communications', 'Nous joindre', 'EN'],
    areaTags: ['schools', 'fr'],
    maxItems: 20,

    detail: {
      fetchWhenNoDate: true,
      alwaysFetch: true, // 保持开启
      concurrency: 3,
    },
  },



  // ------ 91.9 The Bend (Moncton News) ------
  {
    id: '919-the-bend',
    name: '91.9 The Bend',
    enabled: true,
    kind: 'html',
    url: 'https://www.919thebend.ca/news/',
    baseUrl: 'https://www.919thebend.ca',
    selectors: {
      // 兼容常见的 WordPress 列表容器
      listItem: 'article, .post, .type-post, .blog-post',
      title: 'h2 a, h3 a, .entry-title a',
      link: 'h2 a, h3 a, .entry-title a',
      // 日期通常在 time 标签或 .posted-on 容器中
      date: 'time, .posted-on, .entry-date',
      dateAttr: 'datetime',
    },
    // 技巧：匹配 "/202" 可以覆盖 2020-2029 年的所有新闻链接
    // 这样能完美过滤掉 "Contests", "Events" 等非新闻页面
    linkIncludes: ['/202'],
    areaTags: ['moncton', 'news'],
    maxItems: 20,
    detail: {
      fetchWhenNoDate: true,
      alwaysFetch: true, // 必须开启，以获取详情页全文
      concurrency: 3,
    },
  },
  // ------ Saint John Police ------
  {
    id: 'sj-police',
    name: 'Saint John Police',
    enabled: true,
    kind: 'html',
    // 使用媒体发布页作为入口
    url: 'https://saintjohnpolice.ca/media-release/',
    baseUrl: 'https://saintjohnpolice.ca',
    selectors: {
      // Divi 主题/WordPress 常见的文章容器
      listItem: 'article, .et_pb_post, .post',
      title: 'h2.entry-title a, h2 a',
      link: 'h2.entry-title a, h2 a',
      // 列表页通常显示日期，如 "Jan 30, 2026"
      date: '.published, .post-meta time',
      // 详情页正文（Elementor 渲染的主体，避免抓到侧栏列表）
      content: '.elementor-widget-theme-post-content .elementor-widget-container',
    },
    // 确保只抓取媒体通稿，排除杂项
    linkIncludes: ['/media-release/'],
    areaTags: ['police', 'saint john'],
    maxItems: 20,
    detail: {
      fetchWhenNoDate: true,
      alwaysFetch: true, // 开启以进入详情页获取全文
      concurrency: 3,
    },
  },

  // ------ CBC New Brunswick (迁移版) ------
  {
    id: 'cbc-nb',
    name: 'CBC New Brunswick',
    enabled: true,
    kind: 'html',
    url: 'https://www.cbc.ca/news/canada/new-brunswick',
    baseUrl: 'https://www.cbc.ca',
    
    selectors: {
      // 列表项：CBC 的卡片通常是 a.card 结构
      listItem: 'a.card, .card',
      
      // 标题：旧代码里是 .headline
      title: '.headline',
      
      // 链接：如果是 a.card，它自身就是链接；如果是 div.card，找里面的 a
      link: 'a', 
      
      // 列表页通常只有 "X hours ago"，很难解析。
      // 我们故意不在这里强求日期，而是让爬虫进详情页去抓精准的 ISO 时间
      date: 'time, .timestamp',
      
      // 正文：CBC 详情页的正文通常在 .story 或 .story-content 里
      content: '.story, .story-content, .richtext',
    },

    // 过滤：只抓取 NB 省的新闻，排除视频/音频/其他省份
    linkIncludes: ['/news/canada/new-brunswick/'],
    linkExcludes: ['/player/', '/video/', '/radio/'],
    
    areaTags: ['new brunswick', 'cbc'],
    maxItems: 20,

    detail: {
      // 关键策略：因为列表页很难拿到准确日期，强制进入详情页
      fetchWhenNoDate: true, 
      alwaysFetch: true, 
      concurrency: 3,
    },
  },

];
