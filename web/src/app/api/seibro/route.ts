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

export async function POST(req: NextRequest) {
  try {
    const bodyUnknown = (await req.json()) as unknown;
    type Incoming = { apiId?: unknown; params?: unknown };
    const body = bodyUnknown as Incoming;
    const apiId = typeof body.apiId === "string" ? body.apiId.trim() : "";
    const params = (body.params && typeof body.params === "object")
      ? (body.params as Record<string, string>)
      : ({} as Record<string, string>);
    if (!apiId) {
      return new Response(JSON.stringify({ error: "apiId는 필수입니다." }), { status: 400 });
    }

    const url = buildUrl(apiId, params);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      // 한 번 재시도
      res = await fetch(url, { signal: controller.signal });
    }
    clearTimeout(timeout);

    const text = await res.text();
    // Seibro는 XML/JSON 혼재 가능성 → 일단 텍스트 통과, 클라이언트에서 렌더
    return new Response(
      JSON.stringify({ ok: res.ok, status: res.status, headers: Object.fromEntries(res.headers.entries()), body: text }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "서버 오류";
    return new Response(JSON.stringify({ error: msg }), { status: 500 });
  }
}


