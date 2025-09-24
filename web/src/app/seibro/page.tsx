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
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ApiResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<{ ok: boolean; hasKey: boolean } | null>(null);
  const [rows, setRows] = useState<Array<Record<string, string>> | null>(null);
  const [parseType, setParseType] = useState<"xml" | "json" | "text">("text");
  const [emptyNotice, setEmptyNotice] = useState<string | null>(null);
  const [mode, setMode] = useState<"batch" | "single">("batch");

  function resetOutput() {
    setLoading(false);
    setError(null);
    setResult(null);
    setRows(null);
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
          <h1 className="text-xl font-bold">{mode === "batch" ? "통합 조회 (ISIN)" : activeApi.title}</h1>
          <p className="text-sm text-muted-foreground">{mode === "batch" ? "입력한 ISIN으로 여러 API를 동시에 조회합니다." : activeApi.description}</p>
        </div>
        {mode === "single" && (
          <div className="rounded-lg border p-4 bg-white dark:bg-neutral-900 shadow-sm">
            <ParamsForm api={activeApi} onSubmit={(params) => call(activeApi.id, params)} />
          </div>
        )}
        {mode === "batch" && (
          <BatchCard onDone={(merged) => {
            if (!merged || merged.length === 0) {
              setEmptyNotice("데이터가 없습니다.");
              setRows(null);
              setResult(null);
              return;
            }
            setEmptyNotice(null);
            setRows(merged);
            setResult({ ok: true, status: 200, headers: {}, body: JSON.stringify({ merged }, null, 2) });
            setParseType("json");
          }} />
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
                {rows && <div className="text-xs text-neutral-500 dark:text-neutral-400">rows: {rows.length} • parsed: {parseType}</div>}
              </div>
              {rows && rows.length > 0 ? (
                <DataGrid rows={rows} />
              ) : (
                <pre className="text-xs overflow-auto whitespace-pre-wrap break-words bg-neutral-50 dark:bg-neutral-900 p-3 rounded border">
                  {result.body}
                </pre>
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

function DataGrid({ rows }: { rows: Array<Record<string, string>> }) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const [detailRow, setDetailRow] = useState<Record<string, string> | null>(null);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [hideEmpty, setHideEmpty] = useState(true);
  // selection is tracked by normalized keys (suffix after '.') to avoid duplicates
  const [selectedColumns, setSelectedColumns] = useState<string[] | null>(null);

  const columns = useMemo(() => {
    return Array.from(
      rows.reduce((set, r) => {
        Object.keys(r).forEach((k) => set.add(k));
        return set;
      }, new Set<string>())
    );
  }, [rows]);

  // normalize helper and preferred column map for batch results
  const normalize = (c: string) => {
    const i = c.lastIndexOf(".");
    return i >= 0 ? c.slice(i + 1) : c;
  };
  const apiPrefOrder = [
    "getBondStatInfo",
    "getCPInfo",
    "getCDInfo",
    "getESTBInfo",
    "getIntPayInfo",
    "getBondOptionXrcInfo",
  ];
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
    if (/^-?\d{1,3}(?:,\d{3})*(?:\.\d+)?$/.test(value)) return value;
    if (/^-?\d+(?:\.\d+)?$/.test(value)) {
      const num = Number(value);
      if (!Number.isNaN(num)) return num.toLocaleString();
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
    a.download = "seibro-results.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  // computed columns to render
  const renderColumns = useMemo(() => {
    const baseNorm = selectedColumns && selectedColumns.length > 0 ? selectedColumns : previewColumns;
    const mapped = baseNorm.map((n) => preferColumn.get(n) || n);
    if (!hideEmpty) return Array.from(new Set(mapped));
    const set = new Set<string>();
    for (const original of mapped) {
      const norm = normalize(original);
      const hasValue = nonEmptyRows.some((r) => {
        const pref = preferColumn.get(norm) || original;
        const val = r[pref] ?? Object.entries(r).find(([k]) => normalize(k) === norm)?.[1] ?? "";
        return String(val).trim() !== "";
      });
      if (hasValue) set.add(preferColumn.get(norm) || original);
    }
    return Array.from(set);
  }, [selectedColumns, previewColumns, hideEmpty, nonEmptyRows, preferColumn]);

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
                  title={`정렬: ${normalize(col)}`}
                >
                  <div className="flex items-center gap-1">
                    <span title={normalize(col)}>{labelForKey(normalize(col))}</span>
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
                      return formatValue(norm, String(val));
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
                  <div className="text-xs text-neutral-500 dark:text-neutral-400 mb-1">{labelForKey(c)}</div>
                  <div className="text-sm break-words">{formatValue(c, detailRow[c] ?? "")}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function BatchCard({ onDone }: { onDone: (rows: Array<Record<string, string>>) => void }) {
  const [isin, setIsin] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
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
      const merged: Array<Record<string, string>> = [];
      if (data.results && Array.isArray(data.results)) {
        for (const r of data.results) {
          const parsed = parseBodyToRows(r.body);
          if (parsed.rows && parsed.rows.length > 0) {
            // 각 API의 첫 row만 대표로 병합하고, API명 접두사 추가
            const row = parsed.rows[0];
            const prefixed: Record<string, string> = {};
            for (const [k, v] of Object.entries(row)) {
              prefixed[`${r.apiId}.${k}`] = v;
            }
            merged.push(prefixed);
          }
        }
      }
      onDone(merged);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "요청 실패");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-lg border p-4 bg-white dark:bg-neutral-900 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold">통합 조회 (ISIN)</h3>
      </div>
      <div className="flex gap-2">
        <Input placeholder="ISIN 입력" value={isin} onChange={(e) => setIsin(e.target.value)} />
        <Button onClick={run} disabled={loading}>{loading ? "조회중..." : "조회"}</Button>
      </div>
      {error && <div className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</div>}
      <div className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">입력한 ISIN으로 6개 API를 병렬 호출해 유의미한 첫 결과를 합쳐서 보여줍니다.</div>
    </div>
  );
}


