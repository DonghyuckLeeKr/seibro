// Deprecated stub in Vercel mode (Playwright removed)
import { NextRequest } from "next/server";

export async function POST(_req: NextRequest) {
  return new Response(JSON.stringify({ error: "deprecated in Vercel mode" }), { status: 410 });
}


