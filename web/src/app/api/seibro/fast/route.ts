import { NextRequest } from "next/server";

// Uses the existing capture and replay endpoints internally to avoid duplicating logic

type FastBody = { fromDate?: string; toDate?: string };

function rewriteDatesInXml(xml: string, fromDate: string, toDate: string): string {
  let out = xml;
  out = out.replace(/<STD_DT_FR\s+value=\"\d{8}\"\/>/, `<STD_DT_FR value=\"${fromDate}\"/>`);
  out = out.replace(/<STD_DT_TO\s+value=\"\d{8}\"\/>/, `<STD_DT_TO value=\"${toDate}\"/>`);
  return out;
}

export async function POST(req: NextRequest) {
  try {
    const { fromDate, toDate } = (await req.json().catch(() => ({}))) as FastBody;
    const f = typeof fromDate === "string" && /^\d{8}$/.test(fromDate) ? fromDate : undefined;
    const t = typeof toDate === "string" && /^\d{8}$/.test(toDate) ? toDate : f;
    if (!f || !t) {
      return new Response(JSON.stringify({ error: "fromDate/toDate는 YYYYMMDD 형식" }), { status: 400 });
    }

    // 1) Capture the current session requests to get a fresh data call template and cookies
    const proto = req.headers.get("x-forwarded-proto") || "http";
    const host = req.headers.get("host") || "localhost:3000";
    const base = `${proto}://${host}`;
    const capRes = await fetch(`${base}/api/seibro/capture`, { method: "POST" });
    const cap = await capRes.json();
    if (!cap?.calls?.length) {
      return new Response(JSON.stringify({ error: "capture failed" }), { status: 500 });
    }
    // Heuristic: find the EL1 data call
    type CapturedCall = { url: string; method: string; headers: Record<string, string>; postData?: string };
    const calls: Array<CapturedCall> = cap.calls as Array<CapturedCall>;
    const dataCall = calls.find((c) => typeof c.postData === "string" && c.postData.includes("shortmFnceCasebyTdDetailsListEL1"))
      || calls.find((c) => typeof c.postData === "string" && c.postData.includes("shortmFnceCasebyTdDetailsList"))
      || calls[0];
    if (!dataCall) {
      return new Response(JSON.stringify({ error: "data call not found" }), { status: 500 });
    }

    // 2) Rewrite dates in the XML postData
    const postData: string = rewriteDatesInXml(String(dataCall.postData || ""), f, t);

    // 3) Replay
    const replayPayload = {
      url: dataCall.url,
      method: dataCall.method,
      headers: dataCall.headers,
      postData,
      cookies: cap.cookies,
    };

    const repRes = await fetch(`${base}/api/seibro/replay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(replayPayload),
    });
    const rep = await repRes.json();
    const body: string = rep?.body || "";

    const matches = body.match(/<data ve[\s\S]*?<\/data>/g) || [];
    return new Response(JSON.stringify({
      ok: true,
      fromDate: f,
      toDate: t,
      count: matches.length,
      raw: body.slice(0, 20000),
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "fast failed";
    return new Response(JSON.stringify({ ok: false, error: msg }), { status: 500 });
  }
}


