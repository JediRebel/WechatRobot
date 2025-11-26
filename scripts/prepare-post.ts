// scripts/prepare-post.ts
/* eslint-disable no-console */
/**
 * 读取抓取结果 JSON（由 test-all.ts 生成），调用 OpenAI 总结/翻译/去重，输出最终文案。
 *
 * 使用方式示例：
 *   OPENAI_API_KEY=sk-xxxx \
 *   npx ts-node scripts/prepare-post.ts --input out/news.json --output out/post.txt
 *
 * 可选参数：
 *   --model <name>         默认 gpt-4o-mini（兼容 OpenAI 接口）
 *   --maxTokens <number>   默认 1500（限制响应 token 数）
 */

import fs from 'fs';
import path from 'path';
import minimist from 'minimist';

const argv = minimist(process.argv.slice(2), {
  string: ['input', 'output', 'model', 'apiBase'],
  default: {
    input: 'out/news.json',
    output: 'out/post.txt',
    model: 'gpt-4o-mini',
    maxTokens: 1500,
  },
});

const apiKey = process.env.OPENAI_API_KEY;
const apiBase = (argv.apiBase || process.env.OPENAI_BASE || '').replace(/\/$/, '') || 'https://api.openai.com';
if (!apiKey) {
  console.error('❌ 缺少 OPENAI_API_KEY 环境变量');
  process.exit(1);
}

const inputPath = path.resolve(argv.input);
const outputPath = path.resolve(argv.output);

function loadNews() {
  if (!fs.existsSync(inputPath)) {
    console.error(`❌ 找不到输入文件: ${inputPath}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(inputPath, 'utf8');
  const data = JSON.parse(raw) as Array<{
    sourceId: string;
    name: string;
    items: { title: string; link: string; dateISO?: string; source: string }[];
  }>;
  // 只保留有数据的源
  return data.filter((g) => g.items && g.items.length);
}

async function callOpenAI(prompt: string) {
  const res = await fetch(`${apiBase}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: argv.model,
      max_tokens: Number(argv.maxTokens) || 1500,
      messages: [
        {
          role: 'system',
          content:
            '你是一个新闻编辑助手，需按要求输出中文微信消息列表。',
        },
        { role: 'user', content: prompt },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI API error ${res.status}: ${text}`);
  }
  const json = await res.json();
  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new Error('OpenAI API 未返回内容');
  return content as string;
}

async function main() {
  const groups = loadNews();
  const prompt = `
请处理以下 JSON 新闻列表，规则：
1) 这些是过去24小时内的新闻条目；仅保留有数据的源。
2) 对每条新闻：标题翻译为中文，≤15字；生成中文概要，≤30字；保留原文链接。
3) 去重：按事件相似度去掉重复，优先级：教育局 > RCMP > 三个城市官方 > UNB > NB Power > CTV > 其他（相同事件保留优先级高的源）。
4) 输出格式：标题（≤15字） 空格 概要（≤30字） 空格 链接
5) 总长度≤1500字，超出则停止添加下一条，不截断单条。
6) 只输出结果列表，不要说明文字。
JSON 数据：
${JSON.stringify(groups, null, 2)}
`;

  console.log('📤 调用 OpenAI 生成发布文案...');
  const content = await callOpenAI(prompt);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, content.trim(), 'utf8');
  console.log(`✅ 文案已生成: ${outputPath}`);
}

main().catch((err) => {
  console.error('❌ 生成失败:', err.message);
  process.exit(1);
});
