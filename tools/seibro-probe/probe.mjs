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
  context.on('request', async (req) => {
    const url = req.url();
    if (url.includes('/websquare/engine/proworks/callServletService.jsp')) {
      calls.push({
        method: req.method(),
        url,
        headers: req.headers(),
        postData: req.postData(),
        cookies: (await context.cookies()) || [],
      });
    }
  });

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

  // press 조회
  await delay(500);
  await page.keyboard.press('Enter');
  await delay(2000);

  console.log(JSON.stringify({ from, to, segment, captured: calls.slice(-3) }, null, 2));
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });


