import { NextRequest } from "next/server";

type Body = { fromDate?: string; toDate?: string; segment?: string };

function toYYYYMMDD(value: unknown): string | null {
  const s = typeof value === "string" ? value : "";
  if (!/^\d{8}$/.test(s)) return null;
  return s;
}

function parseDataBlocks(xml: string): Array<Record<string, string>> {
  const rows: Array<Record<string, string>> = [];
  const reBlock = /<data\b[\s\S]*?<\/data>/g;
  const blocks = xml.match(reBlock) || [];
  for (const block of blocks) {
    const row: Record<string, string> = {};
  const reField = /<([A-Z0-9_]+)\s+value=\"([^\"]*)\"\/>/g;
  let m: RegExpExecArray | null;
  while ((m = reField.exec(block)) !== null) {
      const key = m[1];
      const val = m[2];
      row[key] = val;
    }
    if (Object.keys(row).length) rows.push(row);
  }
  return rows;
}

function isMatchSegment(row: Record<string, string>, segment: string): boolean {
  if (!segment) return true;
  const seg = segment.trim();
  const nm = row["SHORTM_FNCEGD_NM"] || row["SHORTM_FNCEGD_CD_NM"] || row["SHORTM_FNCEGD_TPNM"] || "";
  if (nm && nm.includes(seg)) return true;
  const cd = row["SHORTM_FNCEGD_CD"] || row["SECN_TPCD"] || "";
  if (!cd) return false;
  // Map codes to human categories
  // 12: 어음(=CP), 13: CD, 14: 전자단기사채(=단기사채)
  const mapped = cd === "13" ? "CD" : cd === "12" ? "CP" : cd === "14" ? "단기사채" : cd;
  return mapped === seg;
}

// Preferred column order and label mapping for table display
export const COLUMN_ORDER: Array<{ key: string; label: string }> = [
  { key: "STD_DT", label: "기준일자" },
  { key: "SELLER_INDTP_TPCD_NM", label: "매도유형" },
  { key: "BUYER_INDTP_TPCD_NM", label: "매수유형" },
  { key: "CUR_CD", label: "통화" },
  { key: "SETL_AMT", label: "매매금액" },
  { key: "CIRCL_PRATE", label: "금리" },
  { key: "SHORTM_FNCEGD_CD_NM", label: "증권구분" },
  { key: "ISIN", label: "종목번호" },
  { key: "SECN_NM", label: "종목명" },
  { key: "ISSU_DT", label: "발행일" },
  { key: "RED_DT", label: "만기일" },
  { key: "GOODS_LEF_XPIR_TPCD_NM", label: "잔존만기" },
  { key: "NUM", label: "순번" },
];

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Body;
    const from = toYYYYMMDD(body.fromDate);
    const to = toYYYYMMDD(body.toDate ?? body.fromDate);
    const segment = typeof body.segment === "string" ? body.segment.trim() : "";
    if (!from || !to) {
      return new Response(JSON.stringify({ error: "fromDate/toDate는 YYYYMMDD" }), { status: 400 });
    }

    // Prime session cookies, then POST to SEIBro internal endpoint with constructed XML
    const SEIBRO_BASE = "https://seibro.or.kr";
    const SEIBRO_URL = `${SEIBRO_BASE}/websquare/engine/proworks/callServletService.jsp`;
    // Map segment to SHORTM_FNCEGD_CD (12:CP, 13:CD, 14:단기사채). Empty means 전체
    const segCode = segment === "CP" ? "12" : segment === "CD" ? "13" : segment === "단기사채" ? "14" : "";
    const COMMON_SUFFIX =
      `<TD_TPCD value=""/>` +
      `<SHORTM_FNCE_INDTP_TPCD value=""/>` +
      `<START_PAGE value="1"/>` +
      `<END_PAGE value="10"/>` +
      `<MENU_NO value="943"/>` +
      `<CMM_BTN_ABBR_NM value="total_search,openall,print,hwp,word,pdf,seach,xls,"/>` +
      `<W2XPATH value="/IPORTAL/user/moneyMarke/BIP_CNTS04033V.xml"/>`;

    const xmlPrimary = `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<reqParam action="shortmFnceCasebyTdDetailsListEL1" task="ksd.safe.bip.cnts.MoneyMarke.process.ShortmFncegdStatPTask">` +
      `<SHORTM_FNCEGD_CD value="${segCode}"/>` +
      `<STD_DT_FR value="${from}"/>` +
      `<STD_DT_TO value="${to}"/>` +
      COMMON_SUFFIX +
      `</reqParam>`;
    const xmlAlt = `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<reqParam action="shortmFnceCasebyTdDetailsList" task="ksd.safe.bip.cnts.MoneyMarke.process.ShortmFncegdStatPTask">` +
      `<SHORTM_FNCEGD_CD value="${segCode}"/>` +
      `<STD_DT_FR value="${from}"/>` +
      `<STD_DT_TO value="${to}"/>` +
      COMMON_SUFFIX +
      `</reqParam>`;

    // 1) Warm up session to obtain cookies (JSESSIONID, WMONID)
    const warm = await fetch(
      `${SEIBRO_BASE}/websquare/control.jsp?w2xPath=/IPORTAL/user/moneyMarke/BIP_CNTS04033V.xml&menuNo=943`,
      { method: "GET", headers: { "User-Agent": "Mozilla/5.0 (compatible; seibro-fast-fetch/1.0)" } }
    );
    const setCookie = warm.headers.get("set-cookie") || "";
    const cookieHeader = setCookie
      .split(",")
      .map((p) => p.split(";")[0].trim())
      .filter((p) => /JSESSIONID|WMONID/i.test(p))
      .join("; ");

    // 2) Data POST
    const doPost = async (seg: string, xmlBody: string) => fetch(SEIBRO_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/xml; charset=\"UTF-8\"",
        Accept: "application/xml",
        Origin: SEIBRO_BASE,
        Referer: `${SEIBRO_BASE}/websquare/control.jsp?w2xPath=/IPORTAL/user/moneyMarke/BIP_CNTS04033V.xml&menuNo=943`,
        "User-Agent": "Mozilla/5.0 (compatible; seibro-fast-fetch/1.0)",
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      },
      body: xmlBody.replace(`<SHORTM_FNCEGD_CD value=\"${segCode}\"/>`, `<SHORTM_FNCEGD_CD value=\"${seg}\"/>`),
    });
    
    // 2a) primary request
    let resp = await doPost(segCode, xmlPrimary);
    let rawText = await resp.text();
    let rows = parseDataBlocks(String(rawText));
    
    // 2b) fallback: if no rows returned, try without segment filter (server-side)
    if (!rows || rows.length === 0) {
      resp = await doPost("", xmlPrimary);
      rawText = await resp.text();
      rows = parseDataBlocks(String(rawText));
    }
    if (!rows || rows.length === 0) {
      resp = await doPost(segCode, xmlAlt);
      rawText = await resp.text();
      rows = parseDataBlocks(String(rawText));
    }
    const filtered = segment ? rows.filter((r) => isMatchSegment(r, segment)) : rows;

    return new Response(
      JSON.stringify({ ok: true, count: filtered.length, rows: filtered.slice(0, 2000) }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "fast-json failed";
    return new Response(JSON.stringify({ ok: false, error: msg }), { status: 500 });
  }
}


