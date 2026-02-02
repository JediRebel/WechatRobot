// src/utils/browser-manager.ts
// 🚨 修改为使用 puppeteer-extra
import puppeteer from "puppeteer-extra"
import StealthPlugin from "puppeteer-extra-plugin-stealth"
import { Browser, Page } from "puppeteer"

// 启用 Stealth 插件
puppeteer.use(StealthPlugin())

class BrowserManager {
  private static instance: BrowserManager
  private browser: any | null = null // 使用 any 兼容 puppeteer-extra 类型

  private constructor() {}

  public static getInstance(): BrowserManager {
    if (!BrowserManager.instance) {
      BrowserManager.instance = new BrowserManager()
    }
    return BrowserManager.instance
  }

  public async getBrowser(): Promise<Browser> {
    if (!this.browser || !this.browser.connected) {
      this.browser = await (puppeteer as any).launch({
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-blink-features=AutomationControlled", // 🚨 保留你原来的关键参数
        ],
      })
    }
    return this.browser
  }

  public async newPage(): Promise<Page> {
    const browser = await this.getBrowser()
    const page = await browser.newPage()

    // 设置和你之前代码一致的 Viewport
    await page.setViewport({ width: 1280, height: 800 })

    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    )

    return page
  }

  public async closeBrowser(): Promise<void> {
    if (this.browser) {
      await this.browser.close()
      this.browser = null
    }
  }
}

export const browserManager = BrowserManager.getInstance()
