import { NextRequest } from "next/server";
import { chromium, Browser, Page, Request as PWRequest } from "playwright";

type CapturedCall = {
  url: string;
  method: string;
  headers: Record<string, string>;
  postData: string | null;
  responseStatus: number | null;
  responseBodySnippet: string | null;
};

const TARGET_URL =
  "https://seibro.or.kr/websquare/control.jsp?w2xPath=/IPORTAL/user/moneyMarke/BIP_CNTS04033V.xml&menuNo=943";
const SERVICE_PATH = "/websquare/engine/proworks/callServletService.jsp";

let sharedBrowser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (sharedBrowser) return sharedBrowser;
  sharedBrowser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-features=VizDisplayCompositor",
    ],
  });
  return sharedBrowser;
}

async function clickSearchIfPresent(page: Page): Promise<void> {
  const selectors = [
    "a:has-text(\uC870\uD68C)",
    "button:has-text(\uC870\uD68C)",
    "span:has-text(\uC870\uD68C)",
    "text=\uC870\uD68C",
  ];
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    if (await loc.count().catch(() => 0)) {
      await loc.click({ timeout: 2000 }).catch(() => undefined);
      break;
    }
  }
}

export async function POST(_req: NextRequest) {
  let page: Page | null = null;
  const captured: CapturedCall[] = [];
  try {
    const browser = await getBrowser();
    const context = await browser.newContext();
    page = await context.newPage();
    page.setDefaultTimeout(60000);

    page.on("requestfinished", async (r: PWRequest) => {
      try {
        const url = r.url();
        if (!url.includes(SERVICE_PATH)) return;
        const method = r.method();
        const headers = await r.allHeaders();
        const postData = r.postData();
        const res = await r.response();
        const status = res ? res.status() : null;
        let snippet: string | null = null;
        try {
          if (res) {
            const text = await res.text();
            snippet = text.slice(0, 4000);
          }
        } catch {
          snippet = null;
        }
        captured.push({
          url,
          method,
          headers,
          postData: postData ?? null,
          responseStatus: status,
          responseBodySnippet: snippet,
        });
      } catch {
        // ignore
      }
    });

    await page.goto(TARGET_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForLoadState("networkidle");

    // Try triggering a fresh query to ensure a POST occurs
    await clickSearchIfPresent(page);
    await page.waitForLoadState("networkidle");

    // Small grace period to ensure all XHRs are flushed
    await page.waitForTimeout(1500);

    const cookies = await context.cookies("https://seibro.or.kr");

    return new Response(
      JSON.stringify({
        ok: true,
        count: captured.length,
        calls: captured,
        cookies,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "capture failed";
    return new Response(JSON.stringify({ ok: false, error: msg, calls: captured }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  } finally {
    try {
      await page?.context().close();
    } catch {}
  }
}


