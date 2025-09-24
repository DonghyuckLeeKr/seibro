export async function GET() {
  const hasKey = Boolean(process.env.SEIBRO_API_KEY);
  return new Response(JSON.stringify({ ok: true, hasKey }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}


