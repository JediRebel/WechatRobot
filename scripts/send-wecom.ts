// scripts/send-wecom.ts
/* eslint-disable no-console */
/**
 * 将文本发送到企业微信机器人 Webhook。
 *
 * 使用示例：
 *   WECOM_WEBHOOK=https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxxx \
 *   npx ts-node scripts/send-wecom.ts --file out/post.txt
 */

import fs from 'fs';
import path from 'path';
import minimist from 'minimist';

const argv = minimist(process.argv.slice(2), {
  string: ['file', 'webhook'],
  default: {
    file: 'out/post.txt',
  },
});

const webhook = (argv.webhook || process.env.WECOM_WEBHOOK || '').trim();
if (!webhook) {
  console.error('❌ 缺少企业微信 Webhook，请设置环境变量 WECOM_WEBHOOK 或传递 --webhook');
  process.exit(1);
}

const filePath = path.resolve(argv.file);
if (!fs.existsSync(filePath)) {
  console.error(`❌ 找不到要发送的文件: ${filePath}`);
  process.exit(1);
}
const content = fs.readFileSync(filePath, 'utf8').trim();
if (!content) {
  console.error('❌ 发送内容为空，已终止。');
  process.exit(1);
}

async function send() {
  const res = await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      msgtype: 'text',
      text: { content },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.errcode) {
    throw new Error(`Webhook error ${res.status}: ${JSON.stringify(data)}`);
  }
  console.log('✅ 已发送到企业微信');
}

send().catch((err) => {
  console.error('❌ 发送失败:', err.message);
  process.exit(1);
});
