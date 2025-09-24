import { NextRequest } from "next/server";
import PQueue from "p-queue";
import pRetry from "p-retry";
import { batchApiIds, BatchApiId, toParamsString } from "@/lib/seibro";

const BASE_URL = process.env.SEIBRO_BASE_URL || "https://seibro.or.kr/OpenPlatform/callOpenAPI.jsp";
const MAX_RETRY = 2;
const QUEUE_INTERVAL_MS = 300;
const REQUEST_TIMEOUT_MS = 15000;

type BatchRequest = { apiId: BatchApiId; params: Record<string, string> };

const queue = new PQueue({ concurrency: 1, interval: QUEUE_INTERVAL_MS, intervalCap: 1 });

function buildUrl(apiId: string, params: Record<string, string>): string {
  const key = process.env.SEIBRO_API_KEY;
  if (!key) throw new Error("서버 환경변수 SEIBRO_API_KEY가 설정되지 않았습니다.");
  const paramsString = toParamsString(params);
  return `${BASE_URL}?key=${encodeURIComponent(key)}&apiId=${encodeURIComponent(apiId)}${
    paramsString ? `&params=${encodeURIComponent(paramsString)}` : ""
  }`;
}

async function executeRequest(apiId: string, params: Record<string, string>) {
  const url = buildUrl(apiId, params);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    const text = await res.text();
    return { apiId, ok: res.ok, status: res.status, body: text };
  } finally {
    clearTimeout(timeout);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { requests?: BatchRequest[] };
    const rawItems = body.requests ?? [];
    const items = rawItems.filter((r): r is BatchRequest => (batchApiIds as readonly string[]).includes(r.apiId));
    if (items.length === 0) {
      return new Response(JSON.stringify({ error: "requests 배열이 필요합니다." }), { status: 400 });
    }

    const results: Array<{ apiId: string; ok: boolean; status: number; body: string }> = [];

    await queue.addAll(
      items.map((item) => async () => {
        try {
          const response = await pRetry(() => executeRequest(item.apiId, item.params ?? {}), {
            retries: MAX_RETRY,
            factor: 1,
            minTimeout: QUEUE_INTERVAL_MS,
            maxTimeout: QUEUE_INTERVAL_MS,
          });
          results.push(response);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          results.push({ apiId: item.apiId, ok: false, status: 500, body: `ERROR: ${message}` });
        }
      })
    );

    return new Response(JSON.stringify({ results }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "서버 오류";
    return new Response(JSON.stringify({ error: msg }), { status: 500 });
  }
}


