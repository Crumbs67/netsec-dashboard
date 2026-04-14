import { ingestEvents } from "@/lib/honeypot-feed";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const payload = await request.json();
  const accepted = ingestEvents(payload);

  return Response.json({
    ok: true,
    accepted: accepted.length,
    source: "cowrie",
  });
}
