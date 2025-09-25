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
    // eslint-disable-next-line no-cond-assign
    while ((m = reField.exec(block))) {
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

    // Delegate capture+replay to fast endpoint, then parse
    const res = await fetch("http://localhost:3000/api/seibro/fast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fromDate: from, toDate: to }),
    });
    const fast = await res.json();
    if (!fast?.raw) {
      return new Response(JSON.stringify({ error: "no data" }), { status: 502 });
    }
    const rows = parseDataBlocks(String(fast.raw));
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


