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

export interface LaunchBrowserOptions {
  readonly headless?: boolean;
}

export async function launchBrowser(
  account: string,
  options: LaunchBrowserOptions = {},
): Promise<ManagedBrowser> {
  const headless = options.headless ?? (process.env.XHS_HEADLESS !== "false");

  const browser: Browser = (await puppeteer.launch({
    headless,
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
      // Use CDP to get ALL cookies across all domains (not just current page)
      const client = await page.createCDPSession();
      const { cookies: allCookies } = await client.send("Network.getAllCookies");
      await saveCookies(allCookies as CookieParam[], account);
    },
    close: async () => {
      await page.close().catch(() => {});
      await browser.close().catch(() => {});
    },
  };
}
