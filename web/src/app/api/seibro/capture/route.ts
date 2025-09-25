// Removed Playwright capture in Vercel mode. Endpoint deprecated.
import { NextRequest } from "next/server";

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
  return new Response(JSON.stringify({ error: "deprecated in Vercel mode" }), { status: 410 });
}


