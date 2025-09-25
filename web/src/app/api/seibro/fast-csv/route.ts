import { NextRequest } from "next/server";

type Body = { fromDate?: string; toDate?: string; segment?: string };

function toYYYYMMDD(value: unknown): string | null {
  const s = typeof value === "string" ? value : "";
  if (!/^\d{8}$/.test(s)) return null;
  return s;
}

function csvEscape(value: string): string {
  const v = value == null ? "" : String(value);
  if (/[",\n]/.test(v)) return '"' + v.replace(/"/g, '""') + '"';
  return v;
}

function formatDate(yyyymmdd?: string): string {
  if (!yyyymmdd || !/^\d{8}$/.test(yyyymmdd)) return yyyymmdd || "";
  return `${yyyymmdd.slice(0,4)}-${yyyymmdd.slice(4,6)}-${yyyymmdd.slice(6,8)}`;
}

function formatAmount(n?: string): string {
  if (!n) return "";
  const onlyNum = String(n).replace(/[^0-9.-]/g, "");
  if (!onlyNum) return n;
  const parts = onlyNum.split(".");
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return parts.join(".");
}

const COLUMN_ORDER: Array<{ key: string; header: string; formatter?: (v: string) => string }> = [
  { key: "STD_DT", header: "기준일자", formatter: formatDate },
  { key: "SELLER_INDTP_TPCD_NM", header: "매도유형" },
  { key: "BUYER_INDTP_TPCD_NM", header: "매수유형" },
  { key: "CUR_CD", header: "통화" },
  { key: "SETL_AMT", header: "매매금액", formatter: formatAmount },
  { key: "CIRCL_PRATE", header: "금리" },
  { key: "SHORTM_FNCEGD_CD_NM", header: "증권구분" },
  { key: "ISIN", header: "종목번호" },
  { key: "SECN_NM", header: "종목명" },
  { key: "ISSU_DT", header: "발행일", formatter: formatDate },
  { key: "RED_DT", header: "만기일", formatter: formatDate },
  { key: "GOODS_LEF_XPIR_TPCD_NM", header: "잔존만기" },
  { key: "NUM", header: "순번" },
];

function toCsv(rows: Array<Record<string, string>>): string {
  if (!rows.length) return "";
  const lines: string[] = [];
  lines.push(COLUMN_ORDER.map(c => csvEscape(c.header)).join(","));
  for (const row of rows) {
    const line = COLUMN_ORDER.map(c => {
      const raw = row[c.key] ?? "";
      const v = c.formatter ? c.formatter(raw) : raw;
      return csvEscape(v);
    }).join(",");
    lines.push(line);
  }
  return lines.join("\n");
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Body;
    const from = toYYYYMMDD(body.fromDate);
    const to = toYYYYMMDD(body.toDate ?? body.fromDate);
    const segment = typeof body.segment === "string" ? body.segment.trim() : "";
    if (!from || !to) {
      return new Response("fromDate/toDate는 YYYYMMDD", { status: 400 });
    }

    const res = await fetch("/api/seibro/fast-json", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fromDate: from, toDate: to, segment }),
    });
    const data = await res.json();
    const rows: Array<Record<string, string>> = Array.isArray(data.rows) ? data.rows : [];
    const csv = toCsv(rows);
    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename=seibro_${from}_${to}${segment ? "_" + segment : ""}.csv`,
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "fast-csv failed";
    return new Response(msg, { status: 500 });
  }
}


