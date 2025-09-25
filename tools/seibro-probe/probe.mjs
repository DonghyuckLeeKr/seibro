import { chromium } from 'playwright';

const TARGET = 'https://seibro.or.kr/websquare/control.jsp?w2xPath=/IPORTAL/user/moneyMarke/BIP_CNTS04033V.xml&menuNo=943';

const from = process.env.FROM || '20250921';
const to = process.env.TO || '20250924';
const segment = process.env.SEGMENT || 'CP'; // CP | CD | 단기사채 | ''

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();

  const calls = [];
  const record = async (req) => {
    const url = req.url();
    if (url.includes('/websquare/engine/proworks/callServletService.jsp')) {
      const entry = {
        method: req.method(),
        url,
        headers: req.headers(),
        postData: req.postData(),
        cookies: (await context.cookies()) || [],
        status: undefined,
        textSample: undefined,
      };
      try {
        const res = await req.response();
        if (res) {
          entry.status = res.status();
          const txt = await res.text();
          entry.textSample = txt.slice(0, 400);
        }
      } catch {}
      calls.push(entry);
    }
  };
  context.on('request', record);
  context.on('requestfinished', record);

  await page.goto(TARGET, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);

  // Try to fill simple inputs by known ids
  try {
    // date inputs are mirrored into hidden yyyyMMdd fields; set them directly
    await page.evaluate(({ from, to }) => {
      const setVal = (id, v) => { const el = document.getElementById(id); if (el) { el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); } };
      setVal('STD_DT_FR', from);
      setVal('STD_DT_TO', to);
    }, { from, to });
  } catch {}

  // click segment if possible, otherwise proceed
  try {
    const segMap = { 'CP': '12', 'CD': '13', '단기사채': '14' };
    const code = segMap[segment] || '';
    await page.evaluate((code) => {
      const sel = document.querySelector('[id*="SHORTM_FNCEGD_CD"]');
      if (sel && code) { sel.value = code; sel.dispatchEvent(new Event('change', { bubbles: true })); }
    }, code);
  } catch {}

  // press 조회 (우선 버튼을 찾아 클릭, 실패 시 Enter)
  await delay(500);
  try {
    const btn = page.getByRole ? page.getByRole('button', { name: /조회/ }) : null;
    if (btn) {
      await btn.click({ timeout: 5000 });
    } else {
      await page.keyboard.press('Enter');
    }
  } catch {
    await page.keyboard.press('Enter');
  }
  await delay(5000);

  // Prefer only the data calls
  const dataCalls = calls.filter(c => /shortmFnceCasebyTdDetailsList/.test(String(c.postData)));

  // If still nothing, issue an in-page fetch to the engine endpoint with the expected XML
  let synthetic = null;
  if (dataCalls.length === 0) {
    try {
      const segMap = { 'CP': '12', 'CD': '13', '단기사채': '14', '': '' };
      const segCode = segMap[segment] ?? '';
      synthetic = await page.evaluate(async ({ from, to, segCode }) => {
        const SEIBRO_BASE = 'https://seibro.or.kr';
        const url = SEIBRO_BASE + '/websquare/engine/proworks/callServletService.jsp';
        const COMMON = '<TD_TPCD value=""/>' +
          '<SHORTM_FNCE_INDTP_TPCD value=""/>' +
          '<START_PAGE value="1"/>' +
          '<END_PAGE value="10"/>' +
          '<MENU_NO value="943"/>' +
          '<CMM_BTN_ABBR_NM value="total_search,openall,print,hwp,word,pdf,seach,xls,"/>' +
          '<W2XPATH value="/IPORTAL/user/moneyMarke/BIP_CNTS04033V.xml"/>';
        const xml = '<?xml version="1.0" encoding="UTF-8"?>' +
          '<reqParam action="shortmFnceCasebyTdDetailsListEL1" task="ksd.safe.bip.moneyMarke.Trade.process.InstEventPTask">' +
          `<SHORTM_FNCEGD_CD value="${segCode}"/>` +
          `<STD_DT_FR value="${from}"/>` +
          `<STD_DT_TO value="${to}"/>` +
          COMMON +
          '</reqParam>';
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/xml; charset="UTF-8"', 'Accept': 'application/xml' },
          body: xml,
        });
        const text = await res.text();
        return { status: res.status, textSample: text.slice(0, 600) };
      }, { from, to, segCode });
    } catch (e) {
      synthetic = { error: String(e) };
    }
  }

  console.log(JSON.stringify({ from, to, segment, captured: dataCalls, synthetic }, null, 2));
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });


