import { NextRequest } from "next/server";
import { chromium, Browser, Page } from "playwright";

type CrawledRow = {
  segment: "CP" | "CD" | "단기사채";
  기준일자: string;
  매도주체: string;
  매수주체: string;
  통화: string;
  배매금액: string;
  금리: string;
  종목구분: string;
  종목번호: string;
  종목명: string;
  발행일: string;
  만기일: string;
  잔존만기: string;
};

const TARGET_URL = "https://seibro.or.kr/websquare/control.jsp?w2xPath=/IPORTAL/user/moneyMarke/BIP_CNTS04033V.xml&menuNo=943";
let browserInstance: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (browserInstance) {
    return browserInstance;
  }
  browserInstance = await chromium.launch({
    headless: true,
  });
  return browserInstance;
}

async function closeBrowser() {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
  }
}

async function loginIfNeeded(page: Page): Promise<void> {
  const username = process.env.SEIBRO_ID;
  const password = process.env.SEIBRO_PASSWORD;
  if (!username || !password) {
    return;
  }
  // 예시 로그인 구현(실제 로그인 동작은 사이트 구조에 따라 조정 필요)
  const loginButton = page.locator("button:has-text('로그인')");
  if (await loginButton.count()) {
    await loginButton.first().click();
    await page.locator("input[name='userId']").fill(username);
    await page.locator("input[name='userPwd']").fill(password);
    await page.locator("button:has-text('확인')").click();
    await page.waitForLoadState("networkidle");
  }
}

async function selectDate(page: Page, fromDate: string, toDate: string) {
  await page.locator("input[id*='FROM_DT']").fill(fromDate);
  await page.locator("input[id*='TO_DT']").fill(toDate);
}

async function selectSegmentAndSearch(page: Page, segmentLabel: string) {
  const segmentLocator = page.locator("label", { hasText: segmentLabel });
  if (await segmentLocator.count()) {
    await segmentLocator.first().click();
  }
  const searchButton = page.locator("button", { hasText: "조회" });
  await searchButton.click();
  await page.waitForLoadState("networkidle");
}

async function extractTable(page: Page, segment: CrawledRow["segment"]): Promise<CrawledRow[]> {
  const rows: CrawledRow[] = [];
  const table = page.locator("table").first();
  const rowCount = await table.locator("tbody tr").count();
  for (let i = 0; i < rowCount; i += 1) {
    const rowLocator = table.locator("tbody tr").nth(i);
    const cells = await rowLocator.locator("td").allInnerTexts();
    if (!cells.length) continue;
    const [순번, 기준일자, 매도주체, 매수주체, 통화, 배매금액, 금리, 종목구분, 종목번호, 종목명, 발행일, 만기일, 잔존만기] = cells;
    rows.push({
      segment,
      기준일자: 기준일자?.trim() ?? "",
      매도주체: 매도주체?.trim() ?? "",
      매수주체: 매수주체?.trim() ?? "",
      통화: 통화?.trim() ?? "",
      배매금액: 배매금액?.trim() ?? "",
      금리: 금리?.trim() ?? "",
      종목구분: 종목구분?.trim() ?? "",
      종목번호: 종목번호?.trim() ?? "",
      종목명: 종목명?.trim() ?? "",
      발행일: 발행일?.trim() ?? "",
      만기일: 만기일?.trim() ?? "",
      잔존만기: 잔존만기?.trim() ?? "",
    });
  }
  return rows;
}

async function crawl({ fromDate, toDate }: { fromDate: string; toDate: string }) {
  const browser = await getBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(TARGET_URL, { waitUntil: "networkidle" });
    await loginIfNeeded(page);
    await selectDate(page, fromDate, toDate);

    const segments: Array<{ label: string; value: CrawledRow["segment"] }> = [
      { label: "CP", value: "CP" },
      { label: "CD", value: "CD" },
      { label: "단기사채", value: "단기사채" },
    ];

    const results: CrawledRow[] = [];
    for (const segment of segments) {
      await selectSegmentAndSearch(page, segment.label);
      const data = await extractTable(page, segment.value);
      results.push(...data);
    }

    return results;
  } finally {
    await context.close();
  }
}

function validateDate(date: string): boolean {
  return /^\d{8}$/.test(date);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const fromDate: string = typeof body.fromDate === "string" && body.fromDate ? body.fromDate : body.date;
    const toDate: string = typeof body.toDate === "string" && body.toDate ? body.toDate : fromDate;

    if (!fromDate || !toDate || !validateDate(fromDate) || !validateDate(toDate)) {
      return new Response(JSON.stringify({ error: "fromDate/toDate는 YYYYMMDD 형식이어야 합니다." }), { status: 400 });
    }

    const rows = await crawl({ fromDate, toDate });
    return new Response(JSON.stringify({ rows }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "크롤링 실패";
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
}

export async function GET() {
  return new Response(JSON.stringify({
    message: "POST /api/seibro/crawl 로 fromDate, toDate(YYYYMMDD) 전달",
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

process.on("SIGTERM", async () => {
  await closeBrowser();
});

process.on("SIGINT", async () => {
  await closeBrowser();
});


