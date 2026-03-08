import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import type { Browser, Page, CookieParam } from "puppeteer";
import { loadCookies, saveCookies } from "./cookies.js";

puppeteer.use(StealthPlugin());

export interface ManagedBrowser {
  readonly page: Page;
  readonly saveCookies: () => Promise<void>;
  readonly close: () => Promise<void>;
}

export async function launchBrowser(account: string): Promise<ManagedBrowser> {
  const headless = process.env.XHS_HEADLESS !== "false";

  const browser: Browser = (await puppeteer.launch({
    headless: headless ? "new" : false,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  })) as Browser;

  const page: Page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  const cookies = await loadCookies(account);
  if (cookies.length > 0) {
    await page.setCookie(...(cookies as CookieParam[]));
  }

  return {
    page,
    saveCookies: async () => {
      const current = await page.cookies();
      await saveCookies(current, account);
    },
    close: async () => {
      await page.close().catch(() => {});
      await browser.close().catch(() => {});
    },
  };
}
