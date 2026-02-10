// scripts/summarize-news.ts
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

import minimist from 'minimist';
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { getUnprocessedNews } from '../src/utils/db';

const argv = minimist(process.argv.slice(2), {
  string: ['output', 'model', 'apiBase'],
  default: {
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

const outputPath = require('path').resolve(argv.output);

async function loadNewsFromDb() {
  const data = await getUnprocessedNews();
  if (!data.length) {
    console.warn('⚠️ 数据库中没有未处理的新闻条目。');
    process.exit(0);
  }

  // 按 cluster_key/标题/链接 选簇代表：官方/机构 > 主流媒体 > 其他；同级取最新时间
  const score = (source: string | undefined): number => {
    const s = (source || '').toLowerCase();
    if (
      /rcmp|police|gov|gouv|gnb|nbpower|health|transport|justice|court|city|town|village|municipal|department|ministry|authority|hospital|school district|university/.test(
        s,
      )
    )
      return 3;
    if (/cbc|ctv|global|reuters|ap|canadian press|saltwire|globalnews|national|bbc/.test(s))
      return 2;
    return 1;
  };

  const getTime = (it: any): number => {
    const dRaw = it.dateISO ?? it.date ?? it.publish_date ?? it.time;
    const d = dRaw ? new Date(dRaw) : null;
    return d instanceof Date && !Number.isNaN(d.getTime()) ? d.getTime() : 0;
  };

  // 因为直接从 DB 取的是扁平列表，这里构造单一分组
  const byKey = new Map<string, any[]>();
  for (const it of data) {
    const k =
      (typeof (it as any).cluster_key === 'string' &&
        (it as any).cluster_key.trim()) ||
      (it.title || '').trim() ||
      (it.link || '').trim();
    if (!k) continue;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push(it);
  }

  const reps: any[] = [];
  for (const [, list] of byKey) {
    const best = list
      .slice()
      .sort((a, b) => {
        const sa = score((a as any).source);
        const sb = score((b as any).source);
        if (sa !== sb) return sb - sa;
        const ta = getTime(a);
        const tb = getTime(b);
        if (ta !== tb) return tb - ta;
        const la = (a.title || '').length;
        const lb = (b.title || '').length;
        return la - lb;
      })[0];
    reps.push(best);
  }

  console.log(`统计：从数据库提取 ${data.length} 条；代表条目后 ${reps.length} 条。`);
  return [
    {
      sourceId: 'db',
      name: 'db',
      items: reps,
    },
  ];
}

async function callOpenAI(prompt: string) {
  const maxAttempts = 3;
  let lastErr: Error | undefined;

  for (let i = 1; i <= maxAttempts; i++) {
    try {
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
    } catch (err: any) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      if (i < maxAttempts) {
        // 简单退避
        await new Promise((r) => setTimeout(r, 1500 * i));
        continue;
      }
    }
  }

  throw lastErr ?? new Error('OpenAI API failed');
}

async function main() {
  const groups = await loadNewsFromDb();
  const prompt = `
请处理以下 JSON 新闻列表，严格按以下规则输出（只输出结果，多行文本，每行一条新闻，不要任何前言/解释/括号/引号/列表符号/JSON）：
0) 禁止输出任何提示、前言或说明，不要写“缺少…因此只包含…”，直接输出结果条目。
1) 仅保留有数据的源；这些都是过去24小时的新闻。
2) 每条：标题翻译为中文且 ≤15字；概要为中文且 ≤60字且不能为空；概要不能仅重述标题或简单加标点，必须补充不同要点（如动作、影响、地点等），必要时可根据标题推断补充；概要必须全中文，不得出现英文标题或前缀；不输出原文链接。如遇暴力/违法/敏感信息，请用中性、克制的表述，避免触发拒绝。
3) 去重：按事件相似度去掉重复，优先级：教育局 > RCMP > 三个城市官方 > UNB > NB Power > CTV > 其他。
4) 输出格式：标题（≤15字） 概要（≤60字），用一个空格分隔；每条之间空一行；不要输出链接。
5) 总长度≤1500字，超出则停止添加下一条，不截断单条。
6) 只输出纯文本列表，不要 JSON、不加中括号/大括号/引号/项目符号。
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
