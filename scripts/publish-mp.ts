// scripts/publish-mp.ts
// 从 out/post.txt 生成一条公众号图文草稿并群发（或预览）
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { addDraft, sendAll, sendPreview } from '../src/wechat/wechat-mp-service';

const PREVIEW_OPENID = process.env.WECHAT_PREVIEW_OPENID || '';

function buildArticle(content: string) {
  const today = new Date().toISOString().slice(0, 10);
  const title = `本地要闻 ${today}`;
  const digest = content.slice(0, 120);

  // 将纯文本转换为简单 HTML（按行转 <p>）
  const html = content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p>${line}</p>`)
    .join('\n');

  return {
    title,
    content: html,
    digest,
    author: '',
    show_cover_pic: 0 as const,
  };
}

async function main() {
  const filePath = path.resolve('out/post.txt');
  if (!fs.existsSync(filePath)) {
    console.error('❌ 未找到 out/post.txt');
    process.exit(1);
  }
  const content = fs.readFileSync(filePath, 'utf8').trim();
  if (!content) {
    console.error('❌ 文案为空');
    process.exit(1);
  }

  try {
    const article = buildArticle(content);
    const mediaId = await addDraft([article]);
    console.log(`✅ 草稿已创建，media_id=${mediaId}`);

    if (PREVIEW_OPENID) {
      await sendPreview(mediaId, PREVIEW_OPENID);
      console.log('✅ 预览已发送给指定 openid');
    } else {
      await sendAll(mediaId);
      console.log('✅ 已群发给全部用户');
    }
  } catch (err: any) {
    console.error('❌ 发布失败:', err.message || err);
    process.exit(1);
  }
}

main();
