// src/wechat/mp-client.ts
// 简单的微信公众号 API 客户端，负责获取/缓存 access_token，并封装带 token 的 GET/POST
import axios from 'axios';
import 'dotenv/config';

const APP_ID = process.env.WECHAT_APP_ID;
const APP_SECRET = process.env.WECHAT_APP_SECRET;

if (!APP_ID || !APP_SECRET) {
  throw new Error('WECHAT_APP_ID 或 WECHAT_APP_SECRET 未配置，请检查 .env');
}

type TokenCache = {
  accessToken: string;
  expiresAt: number; // 时间戳（毫秒）
} | null;

let tokenCache: TokenCache = null;

export class WechatMpClient {
  private appId: string;
  private appSecret: string;

  constructor(appId = APP_ID, appSecret = APP_SECRET) {
    this.appId = appId!;
    this.appSecret = appSecret!;
  }

  /** 获取可用的 access_token（自动缓存） */
  public async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (tokenCache && tokenCache.expiresAt > now + 60_000) {
      return tokenCache.accessToken;
    }

    const url =
      'https://api.weixin.qq.com/cgi-bin/token' +
      `?grant_type=client_credential&appid=${this.appId}&secret=${this.appSecret}`;

    const resp = await axios.get(url);
    const data = resp.data;
    if (data.errcode) {
      throw new Error(`获取 access_token 失败：${data.errcode} ${data.errmsg}`);
    }

    const accessToken = data.access_token as string;
    const expiresIn = data.expires_in as number; // 秒
    tokenCache = {
      accessToken,
      expiresAt: now + (expiresIn - 120) * 1000, // 提前 2 分钟过期
    };
    return accessToken;
  }

  /** 带 access_token 的 GET 请求 */
  public async get<T = any>(url: string, params: Record<string, any> = {}) {
    const accessToken = await this.getAccessToken();
    const resp = await axios.get(url, {
      params: { access_token: accessToken, ...params },
    });
    return resp.data as T;
  }

  /** 带 access_token 的 POST 请求 */
  public async post<T = any>(
    url: string,
    body: any,
    params: Record<string, any> = {},
  ) {
    const accessToken = await this.getAccessToken();
    const resp = await axios.post(url, body, {
      params: { access_token: accessToken, ...params },
    });
    return resp.data as T;
  }
}

export const wechatMpClient = new WechatMpClient();
