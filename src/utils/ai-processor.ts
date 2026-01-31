// src/utils/ai-processor.ts
import { AnyScraperConfig } from "./types"

export interface PromptOptions {
  mode: "smart" | "short" // smart 为你当前的需求，short 为之前的短概要
}

export function generateNewsPrompt(
  groups: any[],
  options: PromptOptions = { mode: "smart" },
) {
  const isSmartMode = options.mode === "smart"

  const rules = isSmartMode
    ? `
   - **正文概要规则**：
     - 如果新闻内容较短（估算不超过500字），请**翻译全文**为中文。
     - 如果新闻内容较长（超过500字），请使用 AI 将其**总结为 500 字以内**的中文内容提要。`
    : `
   - **正文概要规则**：
     - 概要为中文且 ≤60字，必须补充不同要点，不能仅重复标题。`

  return `
请处理以下 JSON 新闻列表，严格按以下规则输出（只输出结果，不要任何前言/解释）：
0) 禁止输出任何提示、前言或说明。
1) 仅保留有数据的源。
2) 处理细节：
   - **标题**：翻译为中文且 ≤15字。
   ${rules}
   - **链接**：保留原文链接。
3) **去重**：按事件相似度去掉重复，优先级：教育局 > RCMP > 城市官方 > UNB > NB Power > CTV > 其他。
4) **输出格式**（每行一条，用一个空格分隔）：标题 概要 链接。
5) 总长度限制：${isSmartMode ? "3000" : "1500"}字。

JSON 数据：
${JSON.stringify(groups, null, 2)}
`
}
