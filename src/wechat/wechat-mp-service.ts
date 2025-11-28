// src/wechat/wechat-mp-service.ts
// 基于 mp-client 提供微信公众号常用操作：创建草稿、群发、预览
import { wechatMpClient } from './mp-client';

export interface MpArticle {
  title: string;
  content: string; // HTML
  digest?: string; // 摘要
  author?: string;
  thumb_media_id?: string; // 若有封面
  show_cover_pic?: 0 | 1;
}

export interface AddDraftResp {
  media_id: string;
  item?: any[];
  errcode?: number;
  errmsg?: string;
}

export async function addDraft(articles: MpArticle[]): Promise<string> {
  const url = 'https://api.weixin.qq.com/cgi-bin/draft/add';
  const data = await wechatMpClient.post<AddDraftResp>(url, { articles });
  if ((data as any).errcode) {
    throw new Error(`新增草稿失败：${(data as any).errcode} ${(data as any).errmsg}`);
  }
  return (data as any).media_id;
}

// 群发到全部用户（或按分组，可扩展 filter）
export async function sendAll(mediaId: string): Promise<void> {
  const url = 'https://api.weixin.qq.com/cgi-bin/message/mass/sendall';
  const data = await wechatMpClient.post(url, {
    filter: { is_to_all: true },
    msgtype: 'mpnews',
    mpnews: { media_id: mediaId },
    send_ignore_reprint: 0,
  });
  if (data.errcode) {
    throw new Error(`群发失败：${data.errcode} ${data.errmsg}`);
  }
}

// 预览（单个 openid），便于上线前自测
export async function sendPreview(mediaId: string, openid: string): Promise<void> {
  const url = 'https://api.weixin.qq.com/cgi-bin/message/mass/preview';
  const data = await wechatMpClient.post(url, {
    touser: openid,
    msgtype: 'mpnews',
    mpnews: { media_id: mediaId },
  });
  if (data.errcode) {
    throw new Error(`预览发送失败：${data.errcode} ${data.errmsg}`);
  }
}
