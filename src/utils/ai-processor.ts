// src/utils/ai-processor.ts
import { AnyScraperConfig } from "./types"

// Ensure 'export' is present here
export interface PromptOptions {
  mode: "smart" | "short"
}

export function generateNewsPrompt(
  groups: any[],
  options: PromptOptions = { mode: "smart" },
) {
  const isSmartMode = options.mode === "smart"

  return `
你是一位专业的海外华人社区新闻主编。请处理以下 JSON 新闻列表。

### 🚨 强制预处理：严禁重复！
- **必须查重**：扫描 JSON，如果多条新闻标题或内容相似（如“保守党支持波利埃夫”），**严禁输出两条**。
- **合并规则**：将不同来源的细节整合进一篇报道中，链接只保留优先级最高的一个。

### 📋 归类板块
归类到：🛡️【治安防范】、🏗️【市政规划】、🍎【社区教育】、⚡【生活服务】、❄️【天气景观】。

### ✍️ 写作与格式规范（重要：请严格遵守标签）
对每一条新闻，必须且只能按以下格式输出，不得漏掉任何 [TAG]：

[TITLE_START] 【此处是中文标题，须包含新闻核心动词，15字以内】 [TITLE_END]
[BODY_START]
此处是 400-600 字的长篇深度报道。
- 要求：涵盖时间、地点、起因、经过、结果。
- 细节：必须包含具体的引用语、数据或部门名称。
- 语言：中文。地名人名保留英文原文。
[BODY_END]
原文链接：URL
---END_OF_ARTICLE---

### ❌ 禁止行为
- **严禁**输出任何前言、总结或“好的，这是为您整理的新闻”。
- **严禁**同一事件分段输出。

JSON 数据：
${JSON.stringify(groups, null, 2)}
`
}
