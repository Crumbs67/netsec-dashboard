import { getFeed, ingestEvents, type HoneypotEvent } from "@/lib/honeypot-feed";

export const dynamic = "force-dynamic";

const MAX_EVENTS = 2000;

function applyFilters(events: HoneypotEvent[], searchParams: URLSearchParams): HoneypotEvent[] {
  const severity = searchParams.get("severity");
  const protocol = searchParams.get("protocol");
  const country = searchParams.get("country");
  const portParam = searchParams.get("port");
  const query = searchParams.get("q")?.toLowerCase().trim();

  const sinceMinutes = Number(searchParams.get("sinceMinutes") ?? "0");
  const sinceCutoff =
    Number.isFinite(sinceMinutes) && sinceMinutes > 0
      ? Date.now() - sinceMinutes * 60 * 1000
      : 0;

  const port = Number(portParam);

  return events.filter((event) => {
    if (severity && event.severity !== severity) {
      return false;
    }

    if (protocol && event.protocol !== protocol) {
      return false;
    }

    if (country && country !== "ALL" && event.country !== country) {
      return false;
    }

    if (portParam && Number.isFinite(port) && event.port !== port) {
      return false;
    }

    if (sinceCutoff > 0 && new Date(event.timestamp).getTime() < sinceCutoff) {
      return false;
    }

    if (query) {
      const haystack = `${event.srcIp} ${event.service} ${event.action}`.toLowerCase();
      if (!haystack.includes(query)) {
        return false;
      }
    }

    return true;
  });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const requestedLimit = Number(searchParams.get("limit") ?? "120");
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(requestedLimit, 1), MAX_EVENTS)
    : 120;
  const filtered = applyFilters(getFeed(MAX_EVENTS), searchParams).slice(0, limit);

  return Response.json(
    {
      generatedAt: new Date().toISOString(),
      count: filtered.length,
      events: filtered,
    },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    },
  );
}

export async function POST(request: Request) {
  const payload = await request.json();
  const normalized = ingestEvents(payload);

  return Response.json({ accepted: normalized.length, ok: true });
}
