import { NextRequest } from "next/server";

const BASE_URL = process.env.SEIBRO_BASE_URL || "https://seibro.or.kr/OpenPlatform/callOpenAPI.jsp";

function buildUrl(apiId: string, params: Record<string, string>): string {
  const key = process.env.SEIBRO_API_KEY;
  if (!key) throw new Error("서버 환경변수 SEIBRO_API_KEY가 설정되지 않았습니다.");
  const paramsString = Object.entries(params)
    .filter(([, v]) => v != null && String(v).trim() !== "")
    .map(([k, v]) => `${k}:${String(v).trim()}`)
    .join(",");
  const url = `${BASE_URL}?key=${encodeURIComponent(key)}&apiId=${encodeURIComponent(apiId)}${
    paramsString ? `&params=${encodeURIComponent(paramsString)}` : ""
  }`;
  return url;
}

type BatchRequest = { apiId: string; params: Record<string, string> };

export async function POST(req: NextRequest) {
  try {
    const bodyUnknown = (await req.json()) as unknown;
    const body = bodyUnknown as { requests?: unknown };
    if (!body.requests || !Array.isArray(body.requests)) {
      return new Response(JSON.stringify({ error: "requests 배열이 필요합니다." }), { status: 400 });
    }
    const items = body.requests as BatchRequest[];

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const results = await Promise.all(
      items.map(async (r) => {
        try {
          const url = buildUrl(r.apiId, r.params || {});
          const res = await fetch(url, { signal: controller.signal });
          const text = await res.text();
          return { apiId: r.apiId, ok: res.ok, status: res.status, body: text };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return { apiId: r.apiId, ok: false, status: 500, body: `ERROR: ${msg}` };
        }
      })
    );
    clearTimeout(timeout);

    return new Response(JSON.stringify({ results }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "서버 오류";
    return new Response(JSON.stringify({ error: msg }), { status: 500 });
  }
}


