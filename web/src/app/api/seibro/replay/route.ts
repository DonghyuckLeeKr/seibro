import { NextRequest } from "next/server";

const BASE = "https://seibro.or.kr";

type ReplayBody = {
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  postData?: string;
  cookies?: Array<{ name: string; value: string; domain?: string; path?: string }>;
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ReplayBody;
    const url = body.url || `${BASE}/websquare/engine/proworks/callServletService.jsp`;
    const method = (body.method || "POST").toUpperCase();
    const headers: Record<string, string> = Object.assign({}, body.headers || {});

    // Normalize cookies into a Cookie header if provided
    if (body.cookies && body.cookies.length) {
      const cookieHeader = body.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
      if (!headers["cookie"]) headers["cookie"] = cookieHeader;
    }
    if (!headers["content-type"]) headers["content-type"] = "application/x-www-form-urlencoded; charset=UTF-8";

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    const res = await fetch(url, {
      method,
      headers,
      body: method === "GET" ? undefined : (body.postData ?? ""),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const text = await res.text();
    return new Response(
      JSON.stringify({
        ok: res.ok,
        status: res.status,
        headers: Object.fromEntries(res.headers.entries()),
        body: text,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "replay failed";
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}


