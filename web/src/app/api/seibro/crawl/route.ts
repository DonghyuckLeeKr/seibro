import { NextRequest } from "next/server";
import { chromium, Browser, Page, Frame, Locator } from "playwright";

// 파싱 결과를 유연하게 담기 위한 타입(강한 키 검사 회피)
type Row = Record<string, string>;

const TARGET_URL = "https://seibro.or.kr/websquare/control.jsp?w2xPath=/IPORTAL/user/moneyMarke/BIP_CNTS04033V.xml&menuNo=943";
let browserInstance: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (browserInstance) {
    return browserInstance;
  }
  // 컨테이너(railway) 환경 대응: 샌드박스 비활성화 및 기본 안정화 옵션 적용
  browserInstance = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-features=VizDisplayCompositor",
    ],
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

// 주어진 셀렉터를 페이지와 모든 프레임에서 찾아 첫 번째 Locator 반환
async function getLocatorInAnyFrame(page: Page, selector: string, timeoutMs = 60000): Promise<Locator> {
  const deadline = Date.now() + timeoutMs;
  // 반복적으로 탐색(프레임 지연 로드 대응)
  while (Date.now() < deadline) {
    // 1) 페이지 직하 탐색
    const direct = page.locator(selector);
    if (await direct.count()) {
      return direct;
    }
    // 2) 모든 프레임 탐색
    const frames: Frame[] = page.frames();
    for (const frame of frames) {
      const loc = frame.locator(selector);
      if (await loc.count()) {
        return loc;
      }
    }
    // 프레임 추가 로드를 위해 잠시 대기
    await page.waitForTimeout(250);
  }
  // 최종 실패 시(호출부에서 waitFor로 다시 한 번 보장)
  return page.locator(selector);
}

async function selectDate(page: Page, fromDate: string, toDate: string) {
  // 프레임/리소스 로드 대기 강화
  await page.waitForLoadState("domcontentloaded");
  await page.waitForLoadState("networkidle");
  // 최소 1개의 iframe이 있을 수 있으므로 잠깐 대기(없어도 통과)
  await page.waitForSelector("iframe", { timeout: 10000 }).catch(() => undefined);

  const fromInput = await getLocatorInAnyFrame(page, "input[id*='FROM_DT']");
  await fromInput.waitFor({ state: "visible", timeout: 60000 });
  await fromInput.fill(fromDate);

  const toInput = await getLocatorInAnyFrame(page, "input[id*='TO_DT']");
  await toInput.waitFor({ state: "visible", timeout: 60000 });
  await toInput.fill(toDate);
}

async function selectSegmentAndSearch(page: Page, segmentLabel: string) {
  // 버튼/라벨도 프레임 안에 있을 수 있으므로 프레임 포함 탐색
  const segment = await getLocatorInAnyFrame(page, `label:has-text("${segmentLabel}")`);
  if (await segment.count()) {
    await segment.first().click();
  }
  const searchButton = await getLocatorInAnyFrame(page, "button:has-text('조회')");
  await searchButton.click();
  await page.waitForLoadState("networkidle");
}

async function extractTable(page: Page, segment: string): Promise<Row[]> {
  const rows: Row[] = [];
  // 표 또한 프레임 내부 가능 → 모든 프레임에서 첫 테이블 탐색
  const tableLocator = await getLocatorInAnyFrame(page, "table");
  const rowCount = await tableLocator.locator("tbody tr").count();
  for (let i = 0; i < rowCount; i += 1) {
    const rowLocator = tableLocator.locator("tbody tr").nth(i);
    const cells = await rowLocator.locator("td").allInnerTexts();
    if (!cells.length) continue;
    // 순번은 사용하지 않으므로 건너뜀
    const [/* 순번 */, 기준일자, 매도주체, 매수주체, 통화, 배매금액, 금리, 종목구분, 종목번호, 종목명, 발행일, 만기일, 잔존만기] = cells;
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
    // 네트워크가 느린 경우를 위해 타임아웃 보강
    page.setDefaultTimeout(60000);
    await page.goto(TARGET_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForLoadState("networkidle");

    await loginIfNeeded(page);
    await selectDate(page, fromDate, toDate);

    const segments: Array<{ label: string; value: string }> = [
      { label: "CP", value: "CP" },
      { label: "CD", value: "CD" },
      { label: "단기사채", value: "단기사채" },
    ];

    const results: Row[] = [];
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


