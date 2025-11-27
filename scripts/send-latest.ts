// scripts/send-latest.ts
// 作用：直接发送当天生成的新闻文案（out/YYYY-MM-DD-post.txt）到企业微信。
import 'dotenv/config';
import axios from 'axios';
import fs from 'fs';
import path from 'path';

async function main() {
  const webhook = process.env.WECOM_WEBHOOK;
  if (!webhook) {
    console.error('WECOM_WEBHOOK is not set in .env');
    process.exit(1);
  }

  const filePath = path.resolve('out/post.txt');
  if (!fs.existsSync(filePath)) {
    console.error('❌ 未找到可发送的文案文件（out/post.txt）');
    process.exit(1);
  }

  const content = fs.readFileSync(filePath, 'utf8').trim();
  if (!content) {
    console.error('❌ 文案为空，已终止。');
    process.exit(1);
  }

  const dateLabel = new Date().toLocaleDateString('zh-CN', {
    timeZone: 'America/Halifax',
    month: 'numeric',
    day: 'numeric',
  });
  const finalContent = `早上好！今天是${dateLabel}，过去24小时本地要闻如下：\n${content}`;

  const payload = {
    msgtype: 'text',
    text: {
      content: finalContent,
    },
  };

  try {
    const res = await axios.post(webhook, payload);
    console.log(`✅ 已发送文案: ${filePath}`);
    console.log('WeCom response:', res.data);
  } catch (err: any) {
    console.error(
      'Send to WeCom failed:',
      err.response?.data || err.message || err,
    );
    process.exit(1);
  }
}

void main();
