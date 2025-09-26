"use client";

import React, { useMemo, useState } from "react";
import { apiList, ApiDefinition, isYYYYMMDD } from "@/lib/seibro";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { labelForKey } from "@/lib/labels";
import { codeToLabel } from "@/lib/codes";

type ApiResult = {
  ok: boolean;
  status: number;
  headers: Record<string, string>;
  body: string;
};

const batchApiIds = [
  "getBondStatInfo",
  "getIntPayInfo",
  "getCDInfo",
  "getCPInfo",
  "getESTBInfo",
] as const;

type BatchApiId = typeof batchApiIds[number];

const batchApiDisplayName: Record<BatchApiId, string> = {
  getBondStatInfo: "채권 종목 정보",
  getIntPayInfo: "이자지급 정보",
  getCDInfo: "CD 정보",
  getCPInfo: "CP 정보",
  getESTBInfo: "전자단기사채 정보",
};

const AMOUNT_FIELD_KEYS = new Set<string>([
  "AMT",
  "TOT_AMT",
  "TOTAMT",
  "BAL_AMT",
  "ISSU_AMT",
  "FIRST_ISSU_AMT",
  "ISSU_REMA",
  "PAYIN_AMT",
  "ERLY_REDAMT",
  "ERLY_REDAMT_VAL",
  "INT_PAY_AMT",
  "FACE_AMT",
  "SALE_AMT",
  "PRCP_AMT",
  "REDEMP_AMT",
]);

const AMOUNT_LABEL_KEYWORDS = ["금액", "잔액", "액면", "상환액", "발행액", "납입액", "지급액"];

function formatThousands(raw: string): string {
  if (!raw) return raw;
  const negative = raw.startsWith("-");
  const unsigned = negative ? raw.slice(1) : raw;
  const [intPartRaw, decimalPart] = unsigned.split(".");
  const intPartNormalized = intPartRaw.replace(/^0+(?=\d)/, "") || "0";
  const withComma = intPartNormalized.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${withComma}${decimalPart ? `.${decimalPart}` : ""}`;
}

function isAmountField(key: string): boolean {
  const upper = key.toUpperCase();
  if (AMOUNT_FIELD_KEYS.has(upper)) return true;
  if (/(?:^|_)[A-Z]*AMT(?:$|_)/.test(upper)) return true;
  const label = labelForKey(upper);
  if (label && label !== upper) {
    if (AMOUNT_LABEL_KEYWORDS.some((keyword) => label.includes(keyword))) {
      return true;
    }
  }
  return false;
}

function formatDateYYYYMMDD(date: Date): string {
  const y = String(date.getFullYear());
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

function previousBusinessDay(baseDate = new Date()): string {
  const dt = new Date(baseDate);
  dt.setHours(0, 0, 0, 0);
  dt.setDate(dt.getDate() - 1);
  while (dt.getDay() === 0 || dt.getDay() === 6) {
    dt.setDate(dt.getDate() - 1);
  }
  return formatDateYYYYMMDD(dt);
}

type ApiStatusValue = {
  status: "idle" | "loading" | "success" | "error" | "empty";
  count: number;
  message?: string;
};

function makeInitialApiStatus(initial: ApiStatusValue["status"] = "idle"): Record<BatchApiId, ApiStatusValue> {
  return batchApiIds.reduce((acc, id) => {
    acc[id] = { status: initial, count: 0 };
    return acc;
  }, {} as Record<BatchApiId, ApiStatusValue>);
}

function parseXmlToRows(xmlText: string): Array<Record<string, string>> | null {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, "application/xml");
    // detect parsererror
    if (doc.getElementsByTagName("parsererror").length > 0) return null;
    // 1) 일반 케이스: <result> 태그(네임스페이스 포함) 모음
    const allElements = Array.from(doc.getElementsByTagName("*"));
    const resultElems = allElements.filter((el) => (el as Element).localName?.toLowerCase() === "result");
    const rows: Array<Record<string, string>> = [];
    const buildRowFromElement = (el: Element) => {
      const row: Record<string, string> = {};
      for (const child of Array.from(el.children)) {
        const key = (child as Element).localName || child.tagName;
        const val = (child as Element).getAttribute("value") ?? child.textContent ?? "";
        row[key] = val;
      }
      if (Object.keys(row).length === 0) {
        for (const attr of Array.from(el.attributes)) {
          row[attr.name] = attr.value;
        }
      }
      return row;
    };

    if (resultElems.length > 0) {
      for (const el of resultElems) {
        rows.push(buildRowFromElement(el as Element));
      }
      return rows;
    }

    // 2) 대안: <data> 하위 레벨이 값만 가진 leaf 노드일 때(Seibro 일부 응답)
    const dataElems = allElements.filter((el) => (el as Element).localName?.toLowerCase() === "data");
    if (dataElems.length > 0) {
      for (const d of dataElems) {
        const kids = Array.from((d as Element).children) as Element[];
        if (kids.length > 0 && kids.every((k) => k.children.length === 0)) {
          // 단일 row로 취급
          const row: Record<string, string> = {};
          for (const k of kids) {
            const key = k.localName || k.tagName;
            const val = k.getAttribute("value") ?? k.textContent ?? "";
            row[key] = val;
          }
          if (Object.keys(row).length > 0) rows.push(row);
        }
      }
      if (rows.length > 0) return rows;
    }

    // 3) 최후의 수단: 루트의 직계(또는 한 단계 하위) 리프 요소들을 단일 row로 수집
    const root = doc.documentElement;
    const leafs = allElements.filter((el) => (el as Element).children.length === 0) as Element[];
    if (leafs.length > 0) {
      const row: Record<string, string> = {};
      for (const leaf of leafs) {
        const key = leaf.localName || leaf.tagName;
        const val = leaf.getAttribute("value") ?? leaf.textContent ?? "";
        // 과도한 루트 메타 키(예: xml 선언, 빈 문자열 등) 배제
        if (key && val && leaf !== root) row[key] = val;
      }
      if (Object.keys(row).length > 0) return [row];
    }
    return null;
  } catch {
    return null;
  }
}

function parseBodyToRows(text: string): { rows: Array<Record<string, string>> | null; type: "xml" | "json" | "text" } {
  // Try JSON first
  try {
    const dataUnknown = JSON.parse(text) as unknown;
    const rows: Array<Record<string, string>> = [];
    const pushObj = (obj: Record<string, unknown>) => {
      const row: Record<string, string> = {};
      for (const [k, v] of Object.entries(obj)) {
        if (v != null && typeof v !== "object") row[k] = String(v);
      }
      if (Object.keys(row).length > 0) rows.push(row);
    };
    if (Array.isArray(dataUnknown)) {
      for (const item of dataUnknown) {
        if (item && typeof item === "object") pushObj(item as Record<string, unknown>);
      }
    } else if (dataUnknown && typeof dataUnknown === "object") {
      const obj = dataUnknown as Record<string, unknown>;
      if ("result" in obj && Array.isArray((obj as { result: unknown }).result)) {
        const arr = (obj as { result: unknown[] }).result;
        for (const item of arr) {
          if (item && typeof item === "object") pushObj(item as Record<string, unknown>);
        }
      } else {
        pushObj(obj);
      }
    }
    if (rows.length > 0) return { rows, type: "json" };
  } catch { /* fallthrough */ }
  // Try XML
  const xmlRows = parseXmlToRows(text);
  if (xmlRows && xmlRows.length > 0) return { rows: xmlRows, type: "xml" };
  return { rows: null, type: "text" };
}

function extractXmlErrorInfo(xmlText: string): { code?: string; message?: string } | null {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, "application/xml");
    if (doc.getElementsByTagName("parsererror").length > 0) return null;
    const header = doc.getElementsByTagName("header")[0];
    if (!header) return null;
    const errorEl = header.getElementsByTagName("error")[0];
    if (!errorEl) return null;
    const codeEl = errorEl.getElementsByTagName("code")[0];
    const contentEl = errorEl.getElementsByTagName("content")[0];
    const code = codeEl?.getAttribute("value") || codeEl?.textContent || undefined;
    const message =
      contentEl?.getAttribute("value") || contentEl?.textContent || undefined;
    if (!code && !message) return null;
    return { code, message };
  } catch {
    return null;
  }
}

function FieldInput({ api, name, value, onChange }: { api: ApiDefinition; name: string; value: string; onChange: (v: string) => void }) {
  const field = api.fields.find((f) => f.name === name)!;
  const id = `${api.id}-${name}`;
  const common = {
    id,
    name,
    className:
      "w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500",
    placeholder: field.placeholder,
    value,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => onChange(e.target.value),
  } as const;

  if (field.type === "select" && field.options) {
    return (
      <Select {...(common as React.SelectHTMLAttributes<HTMLSelectElement>)}>
        <option value="">선택하세요</option>
        {field.options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </Select>
    );
  }
  if (field.type === "date") {
    const isoValue = value && /^\d{8}$/.test(value)
      ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
      : "";
    return (
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          type="text"
          id={id}
          name={name}
          className="w-full"
          placeholder={field.placeholder ?? "YYYYMMDD"}
          value={value}
          inputMode="numeric"
          pattern="\d*"
          maxLength={8}
          onChange={(e) => {
            const digitsOnly = e.target.value.replace(/\D/g, "");
            onChange(digitsOnly.slice(0, 8));
          }}
        />
        <div className="sm:w-44">
          <Input
            type="date"
            id={`${id}-picker`}
            aria-label={`${field.label} 달력 선택`}
            className="w-full"
            value={isoValue}
            onChange={(e) => {
              const next = e.target.value ? e.target.value.replaceAll("-", "") : "";
              onChange(next);
            }}
          />
        </div>
      </div>
    );
  }
  return <Input type="text" {...(common as React.InputHTMLAttributes<HTMLInputElement>)} />;
}

function ParamsForm({ api, onSubmit }: { api: ApiDefinition; onSubmit: (params: Record<string, string>) => void }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // 기본 required 검증
    for (const f of api.fields) {
      if (f.required && !(values[f.name] && values[f.name].trim() !== "")) {
        setError(`${f.label} 필드는 필수입니다.`);
        return;
      }
      if (f.type === "date" && values[f.name] && !isYYYYMMDD(values[f.name])) {
        setError(`${f.label} 형식은 YYYYMMDD 이어야 합니다.`);
        return;
      }
    }
    if (api.validate) {
      const v = api.validate(values);
      if (v) {
        setError(v);
        return;
      }
    }
    setError(null);
    onSubmit(values);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {api.fields.map((f) => (
          <div key={f.name} className="flex flex-col gap-1">
            <label htmlFor={`${api.id}-${f.name}`} className="text-sm font-medium">
              {f.label} {f.required && <span className="text-red-500">*</span>}
            </label>
            <FieldInput
              api={api}
              name={f.name}
              value={values[f.name] || ""}
              onChange={(v) => setValues((p) => ({ ...p, [f.name]: v }))}
            />
            {f.sample && <p className="text-xs text-gray-500">샘플: {f.sample}</p>}
          </div>
        ))}
      </div>
      {error && <div className="text-sm text-red-600">{error}</div>}
      <Button type="submit">조회</Button>
    </form>
  );
}

export default function SeibroPage() {
  const [activeId, setActiveId] = useState<string>(apiList[0].id);
  const activeApi = useMemo(() => apiList.find((a) => a.id === activeId)!, [activeId]);
  const [mode, setMode] = useState<"fast" | "batch" | "single">("fast");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ApiResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<{ ok: boolean; hasKey: boolean } | null>(null);
  const [rows, setRows] = useState<Array<Record<string, string>> | null>(null);
  const [batchTables, setBatchTables] = useState<Array<{ id: BatchApiId; name: string; rows: Array<Record<string, string>> }> | null>(null);
  const [parseType, setParseType] = useState<"xml" | "json" | "text" | "batch" | "crawl">("text");
  const [emptyNotice, setEmptyNotice] = useState<string | null>(null);

  function resetOutput() {
    setLoading(false);
    setError(null);
    setResult(null);
    setRows(null);
    setBatchTables(null);
    setParseType("text");
    setEmptyNotice(null);
  }

  React.useEffect(() => {
    fetch("/api/seibro/health")
      .then((r) => r.json())
      .then((d) => setHealth(d))
      .catch(() => setHealth({ ok: false, hasKey: false }));
  }, []);

  async function call(apiId: string, params: Record<string, string>) {
    try {
      setLoading(true);
      setError(null);
      setResult(null);
      setRows(null);
      setBatchTables(null);
      setEmptyNotice(null);
      const res = await fetch("/api/seibro", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiId, params }),
      });
      const data = (await res.json()) as unknown;
      if (!res.ok || (data as { error?: string })?.error) {
        const errMsg = (data as { error?: string })?.error || `HTTP ${res.status}`;
        throw new Error(errMsg);
      }
      const apiRes = data as ApiResult;
      setResult(apiRes);
      const parsed = parseBodyToRows(apiRes.body);
      setRows(parsed.rows);
      setParseType(parsed.type);
      if (!parsed.rows || parsed.rows.length === 0) {
        setEmptyNotice("데이터가 없습니다.");
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "요청 실패");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen grid grid-cols-1 md:grid-cols-[260px_1fr]">
      <aside className="border-r p-4 bg-white dark:bg-neutral-900">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold">채권 정보 API</h2>
          <div className="text-xs flex items-center gap-2">
            <span
              className={`inline-flex h-2.5 w-2.5 rounded-full ${
                health?.ok && health?.hasKey ? "bg-emerald-500" : "bg-red-500"
              }`}
              title={health?.ok && health?.hasKey ? "API 연결 OK" : "환경설정 필요"}
            />
            <span className="text-muted-foreground">
              {health?.ok && health?.hasKey ? "Connected" : "Not ready"}
            </span>
          </div>
        </div>
        <nav className="space-y-1">
          <button
            onClick={() => { setMode("fast"); resetOutput(); }}
            className={`w-full text-left px-3 py-2 rounded-md text-sm ${
              mode === "fast" ? "bg-indigo-600 text-white" : "hover:bg-neutral-100 dark:hover:bg-neutral-800"
            }`}
          >
            단기금융시장 건별매매내역조회
          </button>
          <button
            onClick={() => { setMode("batch"); resetOutput(); }}
            className={`w-full text-left px-3 py-2 rounded-md text-sm ${
              mode === "batch" ? "bg-indigo-600 text-white" : "hover:bg-neutral-100 dark:hover:bg-neutral-800"
            }`}
          >
            통합 조회 (ISIN)
          </button>
          {apiList.map((api) => (
            <button
              key={api.id}
              onClick={() => { setActiveId(api.id); setMode("single"); resetOutput(); }}
              className={`w-full text-left px-3 py-2 rounded-md text-sm ${
                mode === "single" && activeId === api.id ? "bg-indigo-600 text-white" : "hover:bg-neutral-100 dark:hover:bg-neutral-800"
              }`}
            >
              {api.title}
            </button>
          ))}
        </nav>
      </aside>
      <main className="p-6 space-y-6">
        <div className="space-y-2">
          <h1 className="text-xl font-bold">
            {mode === "fast" ? "단기금융시장 건별매매내역조회" : mode === "batch" ? "통합 조회 (ISIN)" : activeApi.title}
          </h1>
          <p className="text-sm text-muted-foreground">
            {mode === "fast"
              ? "세이브로 내부 API를 직접 호출하여 CP/CD/단기사채의 건별 매매내역을 빠르게 조회합니다."
              : mode === "batch"
                ? "입력한 ISIN으로 여러 API를 동시에 조회합니다."
                : activeApi.description}
          </p>
        </div>
        {mode === "single" && (
          <div className="rounded-lg border p-4 bg-white dark:bg-neutral-900 shadow-sm">
            <ParamsForm api={activeApi} onSubmit={(params) => call(activeApi.id, params)} />
          </div>
        )}
        {mode === "batch" && (
          <BatchCard onDone={(tables) => {
            const hasData = tables.some((table) => table.rows.length > 0);
            setEmptyNotice(hasData ? null : "데이터가 없습니다.");
            setRows(null);
            setBatchTables(tables);
            setResult({ ok: true, status: 200, headers: {}, body: JSON.stringify({ tables }, null, 2) });
            setParseType("batch");
          }} />
        )}
        {mode === "fast" && (
          <CrawlCard
            onDone={({ rows: crawlRows, result: crawlResult }) => {
              const hasData = crawlRows.length > 0;
              setEmptyNotice(hasData ? null : "데이터가 없습니다.");
              setBatchTables(null);
              setRows(crawlRows);
              setResult(crawlResult);
              setParseType("crawl");
            }}
          />
        )}
        <div className="rounded-lg border p-4 bg-white dark:bg-neutral-900 shadow-sm">
          <h3 className="font-semibold mb-2">결과</h3>
          {loading && <p className="text-sm text-muted-foreground">불러오는 중...</p>}
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          {!loading && !error && emptyNotice && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-neutral-500 dark:text-neutral-400">{emptyNotice}</p>
              {mode === "single" && (
                <Button size="sm" variant="outline" onClick={() => setMode("batch")}>통합 조회로 시도</Button>
              )}
            </div>
          )}
          {!loading && !error && result && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-xs text-neutral-500 dark:text-neutral-400">status: {result.status}</div>
                <div className="text-xs text-neutral-500 dark:text-neutral-400">
                  rows: {(batchTables ? batchTables.reduce((sum, t) => sum + t.rows.length, 0) : rows?.length || 0)} • parsed: {parseType}
                </div>
              </div>
              {batchTables && batchTables.length > 0 ? (
                <div className="space-y-6">
                  {batchTables.map((table) => (
                    <div key={table.id} className="space-y-2">
                      <h4 className="text-sm font-semibold">{table.name}</h4>
                      {table.rows.length > 0 ? (
                        <DataGrid rows={table.rows} />
                      ) : (
                        <div className="text-xs text-neutral-500 dark:text-neutral-400 border rounded-md p-3">데이터 없음</div>
                      )}
                    </div>
                  ))}
                </div>
              ) : rows && rows.length > 0 ? (
                <DataGrid rows={rows} csvName={parseType === "crawl" ? "seibro-crawl" : undefined} />
              ) : (
                <div className="text-xs text-neutral-500 dark:text-neutral-400 border rounded-md p-3">데이터 없음</div>
              )}
            </div>
          )}
          {!loading && !error && !result && (
            <p className="text-sm text-neutral-500 dark:text-neutral-400">조회 결과가 여기에 표시됩니다.</p>
          )}
        </div>
      </main>
    </div>
  );
}

function DataGrid({ rows, csvName }: { rows: Array<Record<string, string>>; csvName?: string }) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const [detailRow, setDetailRow] = useState<Record<string, string> | null>(null);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [hideEmpty, setHideEmpty] = useState(true);
  // selection is tracked by normalized keys (suffix after '.') to avoid duplicates
  const [selectedColumns, setSelectedColumns] = useState<string[] | null>(null);

  const LABEL_OVERRIDES: Record<string, string> = {
    API: "API",
    순번: "순번",
    상태: "상태",
    error_code: "오류 코드",
    error_message: "오류 메시지",
  };

  const columns = useMemo(() => {
    return Array.from(
      rows.reduce((set, r) => {
        Object.keys(r).forEach((k) => set.add(k));
        return set;
      }, new Set<string>())
    );
  }, [rows]);

  // Preferred order and labels for money market table (fast-json/fast-csv alignment)
  const PREFERRED_COLUMNS = [
    "STD_DT",
    "SELLER_INDTP_TPCD_NM",
    "BUYER_INDTP_TPCD_NM",
    "CUR_CD",
    "SETL_AMT",
    "CIRCL_PRATE",
    "SHORTM_FNCEGD_CD_NM",
    "ISIN",
    "SECN_NM",
    "ISSU_DT",
    "RED_DT",
    "GOODS_LEF_XPIR_TPCD_NM",
    "NUM",
  ];
  const LABEL_MAP: Record<string, string> = {
    STD_DT: "기준일자",
    SELLER_INDTP_TPCD_NM: "매도유형",
    BUYER_INDTP_TPCD_NM: "매수유형",
    CUR_CD: "통화",
    SETL_AMT: "매매금액",
    CIRCL_PRATE: "금리",
    SHORTM_FNCEGD_CD_NM: "증권구분",
    ISIN: "종목번호",
    SECN_NM: "종목명",
    ISSU_DT: "발행일",
    RED_DT: "만기일",
    GOODS_LEF_XPIR_TPCD_NM: "잔존만기",
    NUM: "순번",
    SELLER_INDTP_TPCD: "매도유형코드",
    BUYER_INDTP_TPCD: "매수유형코드",
    SHORTM_FNCEGD_CD: "증권구분코드",
    GOODS_LEF_XPIR_TPCD: "잔존만기코드",
  };

  // normalize helper and preferred column map for batch results
  const normalize = (c: string) => {
    const i = c.lastIndexOf(".");
    return i >= 0 ? c.slice(i + 1) : c;
  };
  const apiPrefOrder = useMemo(() => [
    "getBondStatInfo",
    "getCPInfo",
    "getCDInfo",
    "getESTBInfo",
    "getIntPayInfo",
    "getBondOptionXrcInfo",
  ], []);
  const preferColumn = useMemo(() => {
    const map = new Map<string, string>(); // normalized -> preferred original key
    for (const c of columns) {
      const norm = normalize(c);
      const current = map.get(norm);
      if (!current) {
        map.set(norm, c);
        continue;
      }
      // prefer unprefixed
      const currentIsPref = current.includes(".");
      const candidateIsPref = c.includes(".");
      if (currentIsPref && !candidateIsPref) {
        map.set(norm, c);
        continue;
      }
      if (currentIsPref && candidateIsPref) {
        // both prefixed: prefer by api order if possible
        const getApi = (key: string) => key.split(".")[0];
        const ci = apiPrefOrder.indexOf(getApi(current));
        const ni = apiPrefOrder.indexOf(getApi(c));
        if (ni !== -1 && (ci === -1 || ni < ci)) {
          map.set(norm, c);
        }
      }
    }
    return map;
  }, [columns, apiPrefOrder]);

  const nonEmptyRows = useMemo(() => rows.filter((r) => Object.values(r).some((v) => String(v ?? "").trim() !== "")), [rows]);

  const sorted = useMemo(() => {
    if (!sortKey) return nonEmptyRows;
    const next = [...nonEmptyRows];
    next.sort((a, b) => {
      const norm = normalize(sortKey);
      const pref = preferColumn.get(norm) || sortKey;
      const av = a[pref] ?? Object.entries(a).find(([k]) => normalize(k) === norm)?.[1] ?? "";
      const bv = b[pref] ?? Object.entries(b).find(([k]) => normalize(k) === norm)?.[1] ?? "";
      if (av === bv) return 0;
      return (av < bv ? -1 : 1) * (sortDir === "asc" ? 1 : -1);
    });
    return next;
  }, [nonEmptyRows, sortKey, sortDir, preferColumn]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const pageRows = sorted.slice((page - 1) * pageSize, page * pageSize);

  const previewColumns = useMemo(() => {
    const priority = [
      "ISIN",
      "KOR_SECN_NM",
      "ISSU_DT",
      "XPIR_DT",
      "ISSU_AMT",
      "FIRST_ISSU_AMT",
      "ISSU_REMA",
      "COUPON_RATE",
      "APLI_DT",
    ];
    const maxPreview = 6;
    const normalizedAll = Array.from(new Set(columns.map((c) => normalize(c))));
    const chosenNorm: string[] = [];
    for (const p of priority) if (normalizedAll.includes(p)) chosenNorm.push(p);
    for (const n of normalizedAll) if (!chosenNorm.includes(n)) chosenNorm.push(n);
    return chosenNorm.slice(0, Math.min(maxPreview, chosenNorm.length));
  }, [columns]);

  // initialize selection with preview columns
  React.useEffect(() => {
    if (!selectedColumns || selectedColumns.length === 0) {
      setSelectedColumns(previewColumns);
    }
  }, [previewColumns, selectedColumns]);

  function formatValue(key: string, value: string): string {
    const coded = codeToLabel(key, value);
    if (coded) return coded;
    if (/^\d{8}$/.test(value)) {
      const y = value.slice(0, 4);
      const m = value.slice(4, 6);
      const d = value.slice(6, 8);
      return `${y}-${m}-${d}`;
    }
    if (/,/.test(value)) return value;
    if (/^-?\d+(?:\.\d+)?$/.test(value)) {
      if (isAmountField(key)) {
        return formatThousands(value);
      }
      return value;
    }
    return value;
  }

  function onSort(col: string) {
    if (sortKey === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(col);
      setSortDir("asc");
    }
  }

  function downloadCsv() {
    const header = columns.join(",");
    const lines = rows.map((r) => columns.map((c) => JSON.stringify(r[c] ?? "")).join(","));
    const csv = [header, ...lines].join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${csvName || "seibro-results"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // computed columns to render
  const renderColumns = useMemo(() => {
    // Build candidate columns based on selection/preview
    const baseNorm = selectedColumns && selectedColumns.length > 0 ? selectedColumns : previewColumns;
    const mapped = baseNorm.map((n) => preferColumn.get(n) || n);
    // Enforce preferred order first when present in dataset
    const present = new Set(mapped.map((c) => normalize(c)));
    const preferredFirst: string[] = [];
    for (const key of PREFERRED_COLUMNS) {
      if (present.has(key)) {
        const original = preferColumn.get(key) || key;
        preferredFirst.push(original);
      }
    }
    // Append the rest
    for (const original of mapped) {
      const norm = normalize(original);
      if (!PREFERRED_COLUMNS.includes(norm)) preferredFirst.push(original);
    }
    // Optionally hide empty columns
    if (!hideEmpty) return Array.from(new Set(preferredFirst));
    const set = new Set<string>();
    for (const original of preferredFirst) {
      const norm = normalize(original);
      const hasValue = nonEmptyRows.some((r) => {
        const pref = preferColumn.get(norm) || original;
        const val = r[pref] ?? Object.entries(r).find(([k]) => normalize(k) === norm)?.[1] ?? "";
        return String(val).trim() !== "";
      });
      if (hasValue) set.add(preferColumn.get(norm) || original);
    }
    return Array.from(set);
  }, [selectedColumns, previewColumns, hideEmpty, nonEmptyRows, preferColumn, PREFERRED_COLUMNS]);

  const displayLabel = (key: string) => {
    if (LABEL_OVERRIDES[key]) return LABEL_OVERRIDES[key];
    const normalized = normalize(key);
    if (LABEL_MAP[normalized]) return LABEL_MAP[normalized];
    if (LABEL_OVERRIDES[normalized]) return LABEL_OVERRIDES[normalized];
    const label = labelForKey(normalized);
    return label || normalized;
  };

  const displayValue = (key: string, value: string) => {
    const normalized = normalize(key);
    return formatValue(normalized, value);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs text-neutral-500 dark:text-neutral-400">{nonEmptyRows.length}건</div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => downloadCsv()}>CSV 다운로드</Button>
          <Button variant="outline" size="sm" onClick={() => setColumnsOpen((o) => !o)}>열 선택</Button>
          <label className="ml-2 inline-flex items-center gap-1 text-xs text-neutral-600 dark:text-neutral-400">
            <input type="checkbox" checked={hideEmpty} onChange={(e) => setHideEmpty(e.target.checked)} /> 빈 열 숨기기
          </label>
        </div>
      </div>
      {columnsOpen && (
        <div className="rounded-md border p-3 max-h-60 overflow-auto bg-white dark:bg-neutral-900">
          <div className="text-xs font-semibold mb-2">표시할 열</div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {Array.from(new Set(columns.map((c) => normalize(c)))).map((norm) => {
              const checked = (selectedColumns || previewColumns).includes(norm);
              return (
                <label key={norm} className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => {
                      setSelectedColumns((prev) => {
                        const base = prev && prev.length > 0 ? [...prev] : [...previewColumns];
                        if (e.target.checked) {
                          if (!base.includes(norm)) base.push(norm);
                        } else {
                          return base.filter((x) => x !== norm);
                        }
                        return base;
                      });
                    }}
                  />
                  <span title={norm}>{labelForKey(norm)}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}
      <div className="rounded-md border overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-neutral-50 dark:bg-neutral-800 sticky top-0">
            <tr>
              {renderColumns.map((col) => (
                <th
                  key={col}
                  className="px-3 py-2 text-left font-semibold border-b cursor-pointer select-none"
                  onClick={() => onSort(col)}
                  title={`정렬: ${displayLabel(col)}`}
                >
                  <div className="flex items-center gap-1">
                    <span title={displayLabel(col)}>{displayLabel(col)}</span>
                    {sortKey && normalize(sortKey) === normalize(col) && (
                      <span className="text-xs">{sortDir === "asc" ? "▲" : "▼"}</span>
                    )}
                  </div>
                </th>
              ))}
              <th className="px-3 py-2 text-left font-semibold border-b">자세히</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r, i) => (
              <tr key={i} className={i % 2 === 0 ? "bg-white dark:bg-neutral-900" : "bg-neutral-50 dark:bg-neutral-900/60"}>
                {renderColumns.map((c) => (
                  <td key={c} className="px-3 py-2 align-top border-b">
                    {(() => {
                      const norm = normalize(c);
                      const pref = preferColumn.get(norm) || c;
                      const val = r[pref] ?? Object.entries(r).find(([k]) => normalize(k) === norm)?.[1] ?? "";
                      return displayValue(norm, String(val));
                    })()}
                  </td>
                ))}
                <td className="px-3 py-2 align-top border-b">
                  <Button variant="outline" size="sm" onClick={() => setDetailRow(r)}>자세히</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>이전</Button>
        <div className="text-xs text-neutral-600 dark:text-neutral-400">{page} / {totalPages}</div>
        <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>다음</Button>
      </div>

      {detailRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDetailRow(null)} />
          <div className="relative max-h-[80vh] w-[min(900px,95vw)] overflow-auto rounded-lg border bg-white p-4 dark:bg-neutral-900">
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-semibold">상세 정보</h4>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => {
                  navigator.clipboard.writeText(JSON.stringify(detailRow, null, 2)).catch(() => {});
                }}>복사</Button>
                <Button size="sm" onClick={() => setDetailRow(null)}>닫기</Button>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {columns.filter((c) => (detailRow?.[c] ?? "").toString().trim() !== "").map((c) => (
                <div key={c} className="rounded-md border p-3">
                  <div className="text-xs text-neutral-500 dark:text-neutral-400 mb-1">{displayLabel(c)}</div>
                  <div className="text-sm break-words">{displayValue(c, detailRow[c] ?? "")}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

type BatchTable = { id: BatchApiId; name: string; rows: Array<Record<string, string>> };

function BatchCard({ onDone }: { onDone: (tables: BatchTable[]) => void }) {
  const [isin, setIsin] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apiStatus, setApiStatus] = useState<Record<BatchApiId, ApiStatusValue>>(() => makeInitialApiStatus("idle"));

  async function run() {
    setLoading(true);
    setError(null);
    const initialStatus = makeInitialApiStatus("loading");
    setApiStatus(initialStatus);

    try {
      if (!isin.trim()) throw new Error("ISIN을 입력하세요");
      const reqs = [
        { apiId: "getBondStatInfo", params: { ISIN: isin.trim() } },
        { apiId: "getIntPayInfo", params: { ISIN: isin.trim() } },
        { apiId: "getBondOptionXrcInfo", params: { ISIN: isin.trim() } },
        { apiId: "getCDInfo", params: { ISIN: isin.trim() } },
        { apiId: "getCPInfo", params: { ISIN: isin.trim() } },
        { apiId: "getESTBInfo", params: { ISIN: isin.trim() } },
      ];
      const res = await fetch("/api/seibro/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requests: reqs }),
      });
      const data = (await res.json()) as { results?: { apiId: string; ok: boolean; status: number; body: string }[] };
      const tableMap = new Map<BatchApiId, { id: BatchApiId; name: string; rows: Array<Record<string, string>> }>();
      const ensureTable = (apiKey: BatchApiId) => {
        if (!tableMap.has(apiKey)) {
          tableMap.set(apiKey, { id: apiKey, name: batchApiDisplayName[apiKey], rows: [] });
        }
        return tableMap.get(apiKey)!;
      };
      const statusUpdate = { ...initialStatus };

      if (data.results && Array.isArray(data.results)) {
        for (const r of data.results) {
          const apiKey = r.apiId as BatchApiId;
          const apiName = batchApiDisplayName[apiKey] ?? apiKey;

          if (!r.ok || r.status !== 200) {
            const message = `HTTP ${r.status}`;
            statusUpdate[apiKey] = { status: "error", count: 0, message };
            ensureTable(apiKey).rows.push({ API: apiName, 상태: message });
            continue;
          }

          const xmlError = extractXmlErrorInfo(r.body);
          if (xmlError) {
            const message = xmlError.message || (xmlError.code ? `코드 ${xmlError.code}` : "API 오류");
            statusUpdate[apiKey] = { status: "error", count: 0, message };
            const errorRow: Record<string, string> = {};
            if (xmlError.code) errorRow[`${r.apiId}.error_code`] = xmlError.code;
            if (xmlError.message) errorRow[`${r.apiId}.error_message`] = xmlError.message;
            if (Object.keys(errorRow).length === 0) errorRow[`${r.apiId}.status`] = message;
            ensureTable(apiKey).rows.push({ API: apiName, ...errorRow });
            continue;
          }

          const parsed = parseBodyToRows(r.body);

          if (!parsed.rows || parsed.rows.length === 0) {
            statusUpdate[apiKey] = { status: "empty", count: 0, message: "데이터 없음" };
            ensureTable(apiKey).rows.push({ API: apiName, 상태: "데이터 없음" });
            continue;
          }

          const table = ensureTable(apiKey);
          const cleanedRows = parsed.rows
            .map((row, index) => {
              const meaningfulEntries = Object.entries(row).filter(([, v]) => v != null && String(v).trim() !== "");
              if (meaningfulEntries.length === 0) {
                return null;
              }
              const prefixed: Record<string, string> = {
                API: apiName,
                순번: String(index + 1),
              };
              for (const [k, v] of meaningfulEntries) {
                prefixed[`${r.apiId}.${k}`] = String(v);
              }
              return prefixed;
            })
            .filter((row): row is Record<string, string> => row !== null);

          if (cleanedRows.length === 0) {
            statusUpdate[apiKey] = { status: "empty", count: 0, message: "데이터 없음" };
            table.rows.push({ API: apiName, 상태: "데이터 없음" });
            continue;
          }

          statusUpdate[apiKey] = {
            status: "success",
            count: cleanedRows.length,
            message: `${cleanedRows.length}건`,
          };
          cleanedRows.forEach((row) => table.rows.push(row));
        }
      }

      setApiStatus(statusUpdate);
      const tables = batchApiIds.map((id) => tableMap.get(id) ?? { id, name: batchApiDisplayName[id], rows: [] });
      onDone(tables);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "요청 실패");
    } finally {
      setLoading(false);
    }
  }

  const apiList: Array<{ id: BatchApiId; name: string }> = [
    { id: "getBondStatInfo", name: "채권 종목 정보" },
    { id: "getIntPayInfo", name: "이자지급 정보" },
    { id: "getCDInfo", name: "CD 정보" },
    { id: "getCPInfo", name: "CP 정보" },
    { id: "getESTBInfo", name: "전자단기사채 정보" },
  ];

  return (
    <div className="rounded-lg border p-4 bg-white dark:bg-neutral-900 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold">통합 조회 (ISIN)</h3>
        <div className="text-xs text-neutral-500 dark:text-neutral-400">5개 API 순차 큐 조회</div>
      </div>
      <div className="flex gap-2">
        <Input placeholder="예: KR6268761881" value={isin} onChange={(e) => setIsin(e.target.value)} />
        <Button onClick={run} disabled={loading}>{loading ? "조회중..." : "조회"}</Button>
      </div>
      <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">채권번호(ISIN) 예시: KR6268761881</p>
      {error && <div className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</div>}

      {/* API별 상태 표시 */}
      <div className="mt-4 space-y-2">
        <div className="text-xs font-semibold">API별 조회 상태</div>
        {apiList.map((api) => {
          const status = apiStatus[api.id];
          const statusIcon = {
            loading: <span className="inline-block w-2 h-2 bg-yellow-500 rounded-full animate-pulse" />,
            success: <span className="inline-block w-2 h-2 bg-green-500 rounded-full" />,
            error: <span className="inline-block w-2 h-2 bg-red-500 rounded-full" />,
            empty: <span className="inline-block w-2 h-2 bg-gray-400 rounded-full" />,
            idle: <span className="inline-block w-2 h-2 bg-gray-500/80 rounded-full" />,
          }[status?.status || 'idle'];

          return (
            <div key={api.id} className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                {statusIcon}
                <span>{api.name}</span>
              </div>
              <span className={`${
                status?.status === 'success' ? 'text-green-600 dark:text-green-400' :
                status?.status === 'error' ? 'text-red-600 dark:text-red-400' :
                status?.status === 'empty' ? 'text-neutral-500 dark:text-neutral-400' :
                status?.status === 'loading' ? 'text-yellow-600 dark:text-yellow-400' :
                'text-neutral-500 dark:text-neutral-400'
              }`}>
                {status?.message ??
                  (status?.status === 'success' ? `${status.count}건` :
                   status?.status === 'error' ? '에러' :
                   status?.status === 'empty' ? '데이터 없음' :
                   status?.status === 'loading' ? '조회중...' :
                   '대기중')}
              </span>
            </div>
          );
        })}
      </div>

    </div>
  );
}

type CrawlCardProps = {
  onDone: (payload: { rows: Array<Record<string, string>>; result: ApiResult }) => void;
};

function CrawlCard({ onDone }: CrawlCardProps) {
  const defaultDate = React.useMemo(() => previousBusinessDay(), []);
  const [fromDate, setFromDate] = useState(defaultDate);
  const [toDate, setToDate] = useState(defaultDate);
  const [segment, setSegment] = useState<string>("CP");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<Record<string, number> | null>(null);
  const [previewRows, setPreviewRows] = useState<Array<Record<string, string>>>([]);
  const [lastRunAt, setLastRunAt] = useState<Date | null>(null);

  const segments = [
    { label: "CP", value: "CP" },
    { label: "CD", value: "CD" },
    { label: "단기사채", value: "단기사채" },
  ] as const;

  const fromIso = React.useMemo(() => (isYYYYMMDD(fromDate) ? `${fromDate.slice(0, 4)}-${fromDate.slice(4, 6)}-${fromDate.slice(6, 8)}` : ""), [fromDate]);
  const toIso = React.useMemo(() => (isYYYYMMDD(toDate) ? `${toDate.slice(0, 4)}-${toDate.slice(4, 6)}-${toDate.slice(6, 8)}` : ""), [toDate]);

  function handleTextDateInput(value: string, setter: (v: string) => void) {
    const digits = value.replace(/\D/g, "").slice(0, 8);
    setter(digits);
  }

  // Fast: 내부 API 직접 호출
  async function runFast() {
    if (!isYYYYMMDD(fromDate) || !isYYYYMMDD(toDate)) {
      setError("조회기간은 YYYYMMDD 형식이어야 합니다.");
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/seibro/fast-json", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromDate, toDate, segment }),
      });
      const data = (await res.json()) as { ok?: boolean; count?: number; rows?: Array<Record<string, string>>; error?: string };
      if (!res.ok || data.error) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const rows = Array.isArray(data.rows) ? data.rows : [];
      const counts: Record<string, number> = { [segment || "CP"]: rows.length } as Record<string, number>;
      setSummary(counts);
      setPreviewRows(rows.slice(0, 5));
      setLastRunAt(new Date());
      onDone({
        rows,
        result: { ok: true, status: 200, headers: { "x-source": "fast" }, body: rows.length > 0 ? "OK" : "EMPTY" },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "빠른 조회 실패");
    } finally {
      setLoading(false);
    }
  }

  async function downloadCsvFast() {
    if (!isYYYYMMDD(fromDate) || !isYYYYMMDD(toDate)) {
      setError("조회기간은 YYYYMMDD 형식이어야 합니다.");
      return;
    }
    try {
      setError(null);
      const res = await fetch("/api/seibro/fast-csv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromDate, toDate, segment }),
      });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `seibro_${fromDate}_${toDate}_${segment || "ALL"}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "CSV 다운로드 실패");
    }
  }

  return (
    <div className="rounded-lg border p-4 bg-white dark:bg-neutral-900 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="font-semibold">단기금융시장 건별매매내역조회</h3>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">조회 기간과 구분을 선택하여 건별 매매내역을 조회합니다.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => { setFromDate(defaultDate); setToDate(defaultDate); }}>
          전 영업일 적용
        </Button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="space-y-2">
          <label className="text-xs font-medium" htmlFor="crawl-from">조회 시작일</label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id="crawl-from"
              placeholder="YYYYMMDD"
              value={fromDate}
              inputMode="numeric"
              pattern="\d*"
              maxLength={8}
              onChange={(e) => handleTextDateInput(e.target.value, setFromDate)}
            />
            <div className="sm:w-44">
              <Input
                type="date"
                value={fromIso}
                onChange={(e) => setFromDate(e.target.value ? e.target.value.replaceAll("-", "") : "")}
              />
            </div>
          </div>
        </div>
        <div className="space-y-2">
          <label className="text-xs font-medium" htmlFor="crawl-to">조회 종료일</label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id="crawl-to"
              placeholder="YYYYMMDD"
              value={toDate}
              inputMode="numeric"
              pattern="\d*"
              maxLength={8}
              onChange={(e) => handleTextDateInput(e.target.value, setToDate)}
            />
            <div className="sm:w-44">
              <Input
                type="date"
                value={toIso}
                onChange={(e) => setToDate(e.target.value ? e.target.value.replaceAll("-", "") : "")}
              />
            </div>
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {segments.map((s) => (
          <label key={s.value} className="inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs cursor-pointer">
            <input
              type="radio"
              name="segment"
              checked={segment === s.value}
              onChange={() => setSegment(s.value)}
            />
            {s.label}
          </label>
        ))}
      </div>
      {error && <div className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</div>}
      <div className="mt-4 flex items-center gap-2 flex-wrap">
        <Button onClick={runFast} disabled={loading}>{loading ? "조회 중..." : "조회"}</Button>
        <Button variant="outline" onClick={downloadCsvFast} disabled={loading}>CSV 다운로드</Button>
        {lastRunAt && (
          <span className="text-xs text-neutral-500 dark:text-neutral-400">마지막 조회: {lastRunAt.toLocaleString()}</span>
        )}
      </div>
      {summary && (
        <div className="mt-4 text-xs text-neutral-600 dark:text-neutral-400 space-y-1">
          <div className="font-semibold">세그먼트별 건수</div>
          {Object.entries(summary).map(([key, value]) => (
            <div key={key}>{key}: {value}건</div>
          ))}
        </div>
      )}
      {previewRows.length > 0 && (
        <div className="mt-4 text-xs text-neutral-600 dark:text-neutral-400 space-y-2">
          <div className="font-semibold">샘플</div>
          {previewRows.slice(0, 5).map((row, idx) => (
            <div key={idx} className="rounded border px-3 py-2 bg-neutral-50 dark:bg-neutral-900/60">
              <div className="flex flex-wrap gap-3">
                <span className="font-medium">{row.segment || row["종목구분"] || row["SHORTM_FNCEGD_CD_NM"] || "-"}</span>
                <span>{row["종목명"] || row["종목번호"] || row["SECN_NM"] || row["ISIN"] || ""}</span>
                <span>금리 {row["금리"] || row["CIRCL_PRATE"] || "-"}</span>
                <span>금액 {row["배매금액"] || row["금액"] || row["SETL_AMT"] || "-"}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


