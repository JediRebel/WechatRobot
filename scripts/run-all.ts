// scripts/run-all.ts
// 一键完成：抓取 -> 生成文案 -> 发送企业微信
import 'dotenv/config';
import { execSync } from 'child_process';
import path from 'path';

function run(cmd: string) {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { stdio: 'inherit' });
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const json = path.join('out', `${today}-news.json`);
  const post = path.join('out', `${today}-post.txt`);

  // 1) 抓取过去 24 小时新闻
  run(
    `npx ts-node -r tsconfig-paths/register -r dotenv/config src/test-all.ts ` +
      `--windowHours 24 --json ${json} --show 999`,
  );

  // 2) 生成中文文案
  run(
    `npx ts-node -r dotenv/config scripts/prepare-post.ts ` +
      `--input ${json} --output ${post} --model gpt-4o-mini`,
  );

  // 3) 发送到企业微信
  run(
    `npx ts-node -r dotenv/config scripts/send-wecom.ts ` +
      `--file ${post}`,
  );
}

main().catch((err) => {
  console.error('❌ run-all failed:', err);
  process.exit(1);
});
