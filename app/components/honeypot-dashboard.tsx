"use client";

import { useEffect, useMemo, useState } from "react";
import { geoNaturalEarth1, geoPath } from "d3-geo";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type HoneypotEvent = {
  id: string;
  timestamp: string;
  srcIp: string;
  country: string;
  protocol: "TCP" | "UDP";
  port: number;
  service: string;
  severity: "low" | "medium" | "high";
  action: string;
  payloadSize: number;
};

type FeedResponse = {
  generatedAt: string;
  events: HoneypotEvent[];
};

type MapFeature = {
  id?: string;
  properties?: {
    name?: string;
  };
  geometry: unknown;
};

type HoverInfo = {
  name: string;
  events: number;
  uniqueIps: number;
  x: number;
  y: number;
};

const REFRESH_MS = 15000;
const MAP_WIDTH = 960;
const MAP_HEIGHT = 440;
const WORLD_GEOJSON_URL =
  "https://raw.githubusercontent.com/holtzy/D3-graph-gallery/master/DATA/world.geojson";

const HEAT_COLOR_STOPS: Array<{ at: number; rgb: [number, number, number] }> = [
  { at: 0, rgb: [74, 168, 102] },
  { at: 0.45, rgb: [231, 204, 74] },
  { at: 0.75, rgb: [239, 139, 54] },
  { at: 1, rgb: [239, 68, 68] },
];

const RANK_BAR_GRADIENTS = [
  "from-fuchsia-400 to-pink-400",
  "from-orange-400 to-amber-300",
  "from-amber-300 to-yellow-200",
  "from-cyan-400 to-blue-400",
  "from-violet-400 to-indigo-400",
  "from-sky-400 to-cyan-300",
];

const MAP_NAME_BY_CODE: Record<string, string> = {
  BR: "Brazil",
  CN: "China",
  DE: "Germany",
  FR: "France",
  IN: "India",
  IR: "Iran",
  NL: "Netherlands",
  RU: "Russia",
  US: "USA",
  VN: "Vietnam",
};

function severityClass(severity: HoneypotEvent["severity"]): string {
  if (severity === "high") {
    return "bg-red-500/15 text-red-300 border-red-400/30";
  }

  if (severity === "medium") {
    return "bg-amber-500/15 text-amber-200 border-amber-300/30";
  }

  return "bg-emerald-500/15 text-emerald-200 border-emerald-300/30";
}

function timeAgo(iso: string): string {
  const ageMs = Date.now() - new Date(iso).getTime();
  const secs = Math.max(1, Math.floor(ageMs / 1000));

  if (secs < 60) {
    return `${secs}s ago`;
  }

  const mins = Math.floor(secs / 60);
  if (mins < 60) {
    return `${mins}m ago`;
  }

  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
}

function getInitialFilter(
  searchParams: { get(name: string): string | null },
  key: string,
  fallback: string,
) {
  return searchParams.get(key) ?? fallback;
}

function getCountryName(code: string): string {
  if (code === "UN") {
    return "Unknown";
  }

  if (code.length === 2 && typeof Intl !== "undefined" && "DisplayNames" in Intl) {
    const display = new Intl.DisplayNames(["en"], { type: "region" });
    return display.of(code) ?? code;
  }

  return code;
}

function getHeatColor(ratio: number): string {
  const bounded = Math.max(0, Math.min(1, ratio));
  const boosted = Math.pow(bounded, 0.85);

  let start = HEAT_COLOR_STOPS[0];
  let end = HEAT_COLOR_STOPS[HEAT_COLOR_STOPS.length - 1];

  for (let i = 1; i < HEAT_COLOR_STOPS.length; i += 1) {
    if (boosted <= HEAT_COLOR_STOPS[i].at) {
      start = HEAT_COLOR_STOPS[i - 1];
      end = HEAT_COLOR_STOPS[i];
      break;
    }
  }

  const segmentRange = Math.max(0.0001, end.at - start.at);
  const localT = Math.max(0, Math.min(1, (boosted - start.at) / segmentRange));
  const r = Math.round(start.rgb[0] + (end.rgb[0] - start.rgb[0]) * localT);
  const g = Math.round(start.rgb[1] + (end.rgb[1] - start.rgb[1]) * localT);
  const b = Math.round(start.rgb[2] + (end.rgb[2] - start.rgb[2]) * localT);

  return `rgb(${r}, ${g}, ${b})`;
}

function getRankBarGradient(index: number): string {
  return RANK_BAR_GRADIENTS[index % RANK_BAR_GRADIENTS.length];
}

function computeThreatLevel(events: HoneypotEvent[], nowMs: number): {
  label: "Low" | "Guarded" | "Elevated" | "High" | "Critical";
  className: string;
} {
  const recentWindowMs = 60 * 1000;
  const recentEvents = events.filter(
    (event) => nowMs - new Date(event.timestamp).getTime() <= recentWindowMs,
  );

  const score = recentEvents.reduce((total, event) => {
    if (event.severity === "high") {
      return total + 4;
    }

    if (event.severity === "medium") {
      return total + 2;
    }

    return total + 1;
  }, 0);

  if (score >= 30 || recentEvents.length >= 12) {
    return {
      label: "Critical",
      className: "border-rose-400/40 bg-rose-500/15 text-rose-100",
    };
  }

  if (score >= 18 || recentEvents.length >= 8) {
    return {
      label: "High",
      className: "border-orange-400/40 bg-orange-500/15 text-orange-100",
    };
  }

  if (score >= 10 || recentEvents.length >= 5) {
    return {
      label: "Elevated",
      className: "border-amber-400/40 bg-amber-500/15 text-amber-100",
    };
  }

  if (score >= 4 || recentEvents.length >= 2) {
    return {
      label: "Guarded",
      className: "border-cyan-400/40 bg-cyan-500/15 text-cyan-100",
    };
  }

  return {
    label: "Low",
    className: "border-emerald-400/40 bg-emerald-500/15 text-emerald-100",
  };
}

export function HoneypotDashboard() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [events, setEvents] = useState<HoneypotEvent[]>([]);
  const [lastUpdate, setLastUpdate] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string>("");
  const [streamState, setStreamState] = useState<"connecting" | "online" | "offline">(
    "connecting",
  );

  const [severityFilter, setSeverityFilter] = useState<string>("ALL");
  const [protocolFilter, setProtocolFilter] = useState<string>("ALL");
  const [countryFilter, setCountryFilter] = useState<string>("ALL");
  const [portFilter, setPortFilter] = useState<string>("");
  const [searchFilter, setSearchFilter] = useState<string>("");
  const [minutesFilter, setMinutesFilter] = useState<string>("60");
  const [mapFeatures, setMapFeatures] = useState<MapFeature[]>([]);
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);
  const [threatTick, setThreatTick] = useState<number>(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => {
      setThreatTick(Date.now());
    }, 1000);

    return () => {
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadMap = async () => {
      try {
        const response = await fetch(WORLD_GEOJSON_URL, { cache: "force-cache" });
        if (!response.ok) {
          return;
        }

        const payload = (await response.json()) as {
          features?: MapFeature[];
        };

        if (!cancelled && Array.isArray(payload.features)) {
          setMapFeatures(payload.features);
        }
      } catch {
        // Keep dashboard functional if map download is blocked.
      }
    };

    loadMap();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setSeverityFilter(getInitialFilter(searchParams, "severity", "ALL"));
    setProtocolFilter(getInitialFilter(searchParams, "protocol", "ALL"));
    setCountryFilter(getInitialFilter(searchParams, "country", "ALL"));
    setPortFilter(getInitialFilter(searchParams, "port", ""));
    setSearchFilter(getInitialFilter(searchParams, "q", ""));
    setMinutesFilter(getInitialFilter(searchParams, "sinceMinutes", "60"));
  }, [searchParams]);

  useEffect(() => {
    const params = new URLSearchParams();

    if (severityFilter !== "ALL") {
      params.set("severity", severityFilter);
    }

    if (protocolFilter !== "ALL") {
      params.set("protocol", protocolFilter);
    }

    if (countryFilter !== "ALL") {
      params.set("country", countryFilter);
    }

    if (portFilter.trim()) {
      params.set("port", portFilter.trim());
    }

    if (searchFilter.trim()) {
      params.set("q", searchFilter.trim());
    }

    if (minutesFilter !== "0") {
      params.set("sinceMinutes", minutesFilter);
    }

    const nextUrl = params.toString() ? `${pathname}?${params.toString()}` : pathname;
    router.replace(nextUrl, { scroll: false });
  }, [
    pathname,
    router,
    severityFilter,
    protocolFilter,
    countryFilter,
    portFilter,
    searchFilter,
    minutesFilter,
  ]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const response = await fetch("/api/honeypot/events?limit=120", {
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error(`Feed request failed with status ${response.status}`);
        }

        const payload = (await response.json()) as FeedResponse;
        if (cancelled) {
          return;
        }

        setEvents(payload.events);
        setLastUpdate(payload.generatedAt);
        setError("");
      } catch (fetchError) {
        if (cancelled) {
          return;
        }

        const message =
          fetchError instanceof Error ? fetchError.message : "Unknown feed error";
        setError(message);
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    load();
    const timer = setInterval(load, REFRESH_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let eventSource: EventSource | null = null;
    let fallbackTimer: ReturnType<typeof setInterval> | null = null;

    const connect = () => {
      setStreamState("connecting");
      eventSource = new EventSource("/api/honeypot/stream");

      eventSource.addEventListener("open", () => {
        if (!cancelled) {
          setStreamState("online");
          setError("");
        }
      });

      eventSource.addEventListener("snapshot", (message) => {
        if (cancelled) {
          return;
        }

        try {
          const payload = JSON.parse((message as MessageEvent).data as string) as FeedResponse;
          setEvents(payload.events);
          setLastUpdate(payload.generatedAt);
          setIsLoading(false);
        } catch {
          setError("Unable to parse stream snapshot");
        }
      });

      eventSource.addEventListener("event", (message) => {
        if (cancelled) {
          return;
        }

        try {
          const payload = JSON.parse((message as MessageEvent).data as string) as {
            event: HoneypotEvent;
          };

          setEvents((previous) => {
            const withoutDuplicate = previous.filter((item) => item.id !== payload.event.id);
            return [payload.event, ...withoutDuplicate].slice(0, 800);
          });
          setLastUpdate(new Date().toISOString());
        } catch {
          setError("Unable to parse live event");
        }
      });

      eventSource.onerror = () => {
        if (!cancelled) {
          setStreamState("offline");
        }
      };

      fallbackTimer = setInterval(async () => {
        if (cancelled || eventSource?.readyState === EventSource.OPEN) {
          return;
        }

        try {
          const response = await fetch("/api/honeypot/events?limit=120", {
            cache: "no-store",
          });

          if (!response.ok) {
            return;
          }

          const payload = (await response.json()) as FeedResponse;
          setEvents(payload.events);
          setLastUpdate(payload.generatedAt);
        } catch {
          // Keep the dashboard usable even if the stream is briefly unavailable.
        }
      }, REFRESH_MS);
    };

    connect();

    return () => {
      cancelled = true;
      if (fallbackTimer) {
        clearInterval(fallbackTimer);
      }
      eventSource?.close();
    };
  }, []);

  const filteredEvents = useMemo(() => {
    const port = Number(portFilter);
    const now = Date.now();
    const minutes = Number(minutesFilter);
    const since = Number.isFinite(minutes) && minutes > 0 ? now - minutes * 60 * 1000 : 0;
    const search = searchFilter.trim().toLowerCase();

    return events.filter((event) => {
      if (severityFilter !== "ALL" && event.severity !== severityFilter) {
        return false;
      }

      if (protocolFilter !== "ALL" && event.protocol !== protocolFilter) {
        return false;
      }

      if (countryFilter !== "ALL" && event.country !== countryFilter) {
        return false;
      }

      if (portFilter && Number.isFinite(port) && event.port !== port) {
        return false;
      }

      if (since > 0 && new Date(event.timestamp).getTime() < since) {
        return false;
      }

      if (search) {
        const haystack = `${event.srcIp} ${event.service} ${event.action}`.toLowerCase();
        if (!haystack.includes(search)) {
          return false;
        }
      }

      return true;
    });
  }, [
    events,
    severityFilter,
    protocolFilter,
    countryFilter,
    portFilter,
    minutesFilter,
    searchFilter,
  ]);

  const countryOptions = useMemo(() => {
    return [...new Set(events.map((event) => event.country))].sort();
  }, [events]);

  const countryStatsByMapName = useMemo(() => {
    const byName = new Map<string, { events: number; ips: Set<string>; countryCode: string }>();

    for (const event of filteredEvents) {
      const mapName = MAP_NAME_BY_CODE[event.country] ?? getCountryName(event.country);
      const existing = byName.get(mapName);

      if (!existing) {
        byName.set(mapName, {
          events: 1,
          ips: new Set([event.srcIp]),
          countryCode: event.country,
        });
        continue;
      }

      existing.events += 1;
      existing.ips.add(event.srcIp);
    }

    return byName;
  }, [filteredEvents]);

  const originHeat = useMemo(() => {
    return [...countryStatsByMapName.entries()]
      .map(([mapName, stats]) => ({
        countryCode: stats.countryCode,
        countryName: getCountryName(stats.countryCode),
        mapName,
        count: stats.events,
        uniqueIps: stats.ips.size,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }, [countryStatsByMapName]);

  const mapHeatMax = useMemo(() => {
    const maxValue = Math.max(
      0,
      ...[...countryStatsByMapName.values()].map((stats) => stats.events),
    );
    return Math.max(1, maxValue);
  }, [countryStatsByMapName]);

  const mapPathData = useMemo(() => {
    if (!mapFeatures.length) {
      return [] as Array<{
        id: string;
        name: string;
        path: string;
        events: number;
        uniqueIps: number;
      }>;
    }

    const featureCollection = {
      type: "FeatureCollection",
      features: mapFeatures,
    };

    const projection = geoNaturalEarth1().fitSize(
      [MAP_WIDTH, MAP_HEIGHT],
      featureCollection as never,
    );
    const pathBuilder = geoPath(projection);

    return mapFeatures
      .map((feature, index) => {
        const name = feature.properties?.name ?? `region-${index}`;
        const path = pathBuilder(feature as never) ?? "";
        const stats = countryStatsByMapName.get(name);

        return {
          id: feature.id ?? `${name}-${index}`,
          name,
          path,
          events: stats?.events ?? 0,
          uniqueIps: stats?.ips.size ?? 0,
        };
      })
      .filter((feature) => feature.path);
  }, [mapFeatures, countryStatsByMapName]);

  const summary = useMemo(() => {
    const uniqueIps = new Set(filteredEvents.map((event) => event.srcIp)).size;
    const highSeverity = filteredEvents.filter((event) => event.severity === "high").length;

    const byPort = new Map<number, number>();
    const byIp = new Map<string, number>();

    for (const event of filteredEvents) {
      byPort.set(event.port, (byPort.get(event.port) ?? 0) + 1);
      byIp.set(event.srcIp, (byIp.get(event.srcIp) ?? 0) + 1);
    }

    const topPorts = [...byPort.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([port, count]) => ({ port, count }));

    const topIps = [...byIp.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([ip, hits]) => ({ ip, hits }));

    const latest = filteredEvents[0]?.timestamp;

    return {
      total: filteredEvents.length,
      uniqueIps,
      highSeverity,
      topPorts,
      topIps,
      latest,
    };
  }, [filteredEvents]);

  const topPortMax = Math.max(1, ...summary.topPorts.map((item) => item.count));
  const heatMax = Math.max(1, ...originHeat.map((item) => item.count));
  const threatLevel = useMemo(
    () => computeThreatLevel(filteredEvents, threatTick),
    [filteredEvents, threatTick],
  );
  const liveSnapshot = useMemo(() => {
    const now = threatTick;
    const last60s = filteredEvents.filter(
      (event) => now - new Date(event.timestamp).getTime() <= 60 * 1000,
    );
    const last5m = filteredEvents.filter(
      (event) => now - new Date(event.timestamp).getTime() <= 5 * 60 * 1000,
    );
    const highLast5m = last5m.filter((event) => event.severity === "high").length;
    const activeCountries = new Set(last5m.map((event) => event.country)).size;
    const avgPayload =
      last5m.length > 0
        ? Math.round(
            last5m.reduce((total, event) => total + (event.payloadSize ?? 0), 0) /
              last5m.length,
          )
        : 0;

    return {
      eps: last60s.length,
      last5m: last5m.length,
      highLast5m,
      activeCountries,
      avgPayload,
      streamHealth: streamState === "online" ? "Healthy" : "Degraded",
    };
  }, [filteredEvents, streamState, threatTick]);

  const intelSummary = useMemo(() => {
    const severityCounts = { high: 0, medium: 0, low: 0 };
    const protocolCounts = { TCP: 0, UDP: 0 };
    const byService = new Map<string, number>();

    for (const event of filteredEvents) {
      severityCounts[event.severity] += 1;
      protocolCounts[event.protocol] += 1;
      byService.set(event.service, (byService.get(event.service) ?? 0) + 1);
    }

    const topServices = [...byService.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([service, count]) => ({ service, count }));

    const total = Math.max(1, filteredEvents.length);

    return {
      severityCounts,
      protocolCounts,
      topServices,
      total,
      tcpPct: Math.round((protocolCounts.TCP / total) * 100),
      udpPct: Math.round((protocolCounts.UDP / total) * 100),
    };
  }, [filteredEvents]);

  return (
    <main className="relative min-h-screen overflow-hidden bg-slate-950 text-slate-100">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_15%,rgba(14,165,233,0.25),transparent_33%),radial-gradient(circle_at_85%_20%,rgba(249,115,22,0.24),transparent_36%),radial-gradient(circle_at_40%_95%,rgba(34,197,94,0.2),transparent_40%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-20 [background-image:linear-gradient(rgba(148,163,184,0.2)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.2)_1px,transparent_1px)] [background-size:34px_34px]" />

      <section className="relative mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8 sm:px-8 sm:py-12">
        <header className="rounded-2xl border border-sky-500/20 bg-[#0a1327]/85 p-6 shadow-[0_0_0_1px_rgba(56,189,248,0.08),0_18px_45px_rgba(2,12,30,0.45)] backdrop-blur-md">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-cyan-300/90">
                Live Sensor Telemetry
              </p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                Honeypot Threat Command Board
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-slate-300">
                Real-time stream of inbound activity with automatic refresh every 3
                seconds.
              </p>
            </div>
            <div className="space-y-2">
              <div className="rounded-xl border border-emerald-400/35 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-200">
                <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-300" />{" "}
                Stream {streamState === "online" ? "Online" : streamState === "connecting" ? "Connecting" : "Offline"}
              </div>
              <div
                className={`rounded-xl border px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] ${threatLevel.className}`}
              >
                Threat Level: {threatLevel.label}
              </div>
            </div>
          </div>
          <p className="mt-4 text-xs text-slate-400">
            Last refresh: {lastUpdate ? new Date(lastUpdate).toLocaleString() : "-"}
          </p>
          <div className="mt-4">
            <a
              href="#live-event-stream"
              className="inline-flex items-center rounded-lg border border-cyan-400/35 bg-cyan-500/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-cyan-200 transition hover:bg-cyan-500/20"
            >
              Scroll To Live Logs
            </a>
          </div>
        </header>

        <section className="grid grid-cols-1 gap-3 rounded-2xl border border-white/15 bg-slate-900/80 p-4 sm:grid-cols-2 xl:grid-cols-6">
          <label className="flex flex-col gap-1 text-xs text-slate-300">
            Severity
            <select
              value={severityFilter}
              onChange={(event) => setSeverityFilter(event.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-sm"
            >
              <option value="ALL">All</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </label>

          <label className="flex flex-col gap-1 text-xs text-slate-300">
            Protocol
            <select
              value={protocolFilter}
              onChange={(event) => setProtocolFilter(event.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-sm"
            >
              <option value="ALL">All</option>
              <option value="TCP">TCP</option>
              <option value="UDP">UDP</option>
            </select>
          </label>

          <label className="flex flex-col gap-1 text-xs text-slate-300">
            Country
            <select
              value={countryFilter}
              onChange={(event) => setCountryFilter(event.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-sm"
            >
              <option value="ALL">All</option>
              {countryOptions.map((country) => (
                <option key={country} value={country}>
                  {getCountryName(country)}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-xs text-slate-300">
            Port
            <input
              value={portFilter}
              onChange={(event) => setPortFilter(event.target.value)}
              placeholder="22"
              className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-sm"
            />
          </label>

          <label className="flex flex-col gap-1 text-xs text-slate-300">
            Search
            <input
              value={searchFilter}
              onChange={(event) => setSearchFilter(event.target.value)}
              placeholder="IP, service, action"
              className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-sm"
            />
          </label>

          <label className="flex flex-col gap-1 text-xs text-slate-300">
            Time Window
            <select
              value={minutesFilter}
              onChange={(event) => setMinutesFilter(event.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-sm"
            >
              <option value="0">All time</option>
              <option value="5">Last 5 min</option>
              <option value="15">Last 15 min</option>
              <option value="60">Last 60 min</option>
              <option value="240">Last 4 hours</option>
            </select>
          </label>
        </section>

        {error ? (
          <div className="rounded-xl border border-red-400/40 bg-red-500/10 p-4 text-sm text-red-200">
            Feed error: {error}
          </div>
        ) : null}

        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border border-cyan-400/20 bg-slate-900/75 p-5">
            <p className="text-xs uppercase tracking-widest text-cyan-300">Total Hits</p>
            <p className="mt-3 text-3xl font-semibold text-cyan-100">{summary.total}</p>
          </div>
          <div className="rounded-2xl border border-indigo-400/20 bg-slate-900/75 p-5">
            <p className="text-xs uppercase tracking-widest text-indigo-300">Unique IPs</p>
            <p className="mt-3 text-3xl font-semibold text-indigo-100">
              {summary.uniqueIps}
            </p>
          </div>
          <div className="rounded-2xl border border-red-400/20 bg-slate-900/75 p-5">
            <p className="text-xs uppercase tracking-widest text-red-300">High Severity</p>
            <p className="mt-3 text-3xl font-semibold text-red-100">
              {summary.highSeverity}
            </p>
          </div>
          <div className="rounded-2xl border border-emerald-400/20 bg-slate-900/75 p-5">
            <p className="text-xs uppercase tracking-widest text-emerald-300">Most Recent</p>
            <p className="mt-3 text-2xl font-semibold text-emerald-100">
              {summary.latest ? timeAgo(summary.latest) : "-"}
            </p>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <div className="rounded-2xl border border-sky-500/20 bg-[#0b1630]/85 p-5 shadow-[inset_0_1px_0_rgba(148,163,184,0.08)] xl:col-span-1">
            <h2 className="text-lg font-semibold text-sky-100">Top Attack Origins</h2>
            <p className="mt-1 text-xs text-slate-400">Country distribution, last 7d</p>
            <div className="mt-4 space-y-3">
              {summary.topIps.map((attacker, index) => {
                const widthPct = Math.round((attacker.hits / Math.max(1, summary.topIps[0]?.hits ?? 1)) * 100);
                const gradient = getRankBarGradient(index);

                return (
                  <div key={attacker.ip} className="space-y-1.5">
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2 text-slate-200">
                        <span className="text-[11px] text-slate-400">#{index + 1}</span>
                        <span className="font-mono">{attacker.ip}</span>
                      </div>
                      <span className="font-semibold text-slate-300">{attacker.hits}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-slate-800/90">
                      <div
                        className={`h-full rounded-full bg-gradient-to-r ${gradient}`}
                        style={{ width: `${widthPct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
              {!summary.topIps.length && !isLoading ? (
                <p className="text-sm text-slate-400">No attacker data yet.</p>
              ) : null}
            </div>
          </div>

          <div className="rounded-2xl border border-sky-500/20 bg-[#0b1630]/85 p-5 shadow-[inset_0_1px_0_rgba(148,163,184,0.08)] xl:col-span-2">
            <h2 className="text-lg font-semibold text-sky-100">Top Networks (Services/Ports)</h2>
            <p className="mt-1 text-xs text-slate-400">Most targeted endpoints in the active filter window</p>
            <div className="mt-4 space-y-3">
              {summary.topPorts.map((item, index) => {
                const widthPct = Math.round((item.count / topPortMax) * 100);
                const gradient = getRankBarGradient(index);
                return (
                  <div key={item.port} className="space-y-1.5">
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2 text-slate-300">
                        <span className="text-[11px] text-slate-500">#{index + 1}</span>
                        <span className="font-mono">:{item.port}</span>
                      </div>
                      <span className="text-slate-300">{item.count} events</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-slate-800/90">
                      <div
                        className={`h-full rounded-full bg-gradient-to-r ${gradient} transition-all duration-700`}
                        style={{ width: `${widthPct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
              {!summary.topPorts.length && !isLoading ? (
                <p className="text-sm text-slate-400">No port activity yet.</p>
              ) : null}
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <div className="rounded-2xl border border-white/15 bg-slate-900/80 p-5 xl:col-span-2">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-white">Origin Heat</h2>
                <p className="text-sm text-slate-400">
                  Attack density by country for the currently filtered feed.
                </p>
              </div>
              <div className="rounded-full border border-cyan-400/25 bg-cyan-500/10 px-3 py-1 text-xs text-cyan-200">
                {originHeat.length} regions
              </div>
            </div>

            <div className="relative mt-4 rounded-xl border border-slate-700/80 bg-slate-950/50 p-3">
              <svg
                viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
                className="h-auto w-full"
                role="img"
                aria-label="World map of attack origins"
              >
                {mapPathData.map((shape) => {
                  const ratio = Math.min(1, shape.events / mapHeatMax);
                  const fill = shape.events > 0 ? getHeatColor(ratio) : "rgb(39, 52, 79)";

                  return (
                    <path
                      key={shape.id}
                      d={shape.path}
                      fill={fill}
                      stroke="rgb(71, 85, 105)"
                      strokeWidth={0.55}
                      onMouseMove={(event) => {
                        setHoverInfo({
                          name: shape.name,
                          events: shape.events,
                          uniqueIps: shape.uniqueIps,
                          x: event.nativeEvent.offsetX + 16,
                          y: event.nativeEvent.offsetY + 16,
                        });
                      }}
                      onMouseLeave={() => setHoverInfo(null)}
                    >
                      <title>
                        {shape.name}: {shape.events} attacks from {shape.uniqueIps} unique source IPs
                      </title>
                    </path>
                  );
                })}
              </svg>

              <div className="mt-3 flex items-center justify-between gap-2 text-[11px] text-slate-400">
                <span>Low activity</span>
                <div className="h-2.5 flex-1 rounded-full bg-gradient-to-r from-emerald-500 via-amber-400 to-red-500" />
                <span>High activity</span>
              </div>

              {hoverInfo ? (
                <div
                  className="pointer-events-none absolute z-20 rounded-lg border border-red-300/30 bg-slate-900/95 px-3 py-2 text-xs text-slate-100 shadow-lg"
                  style={{ left: hoverInfo.x, top: hoverInfo.y }}
                >
                  <p className="font-semibold text-red-200">{hoverInfo.name}</p>
                  <p>{hoverInfo.events} attacks</p>
                  <p>{hoverInfo.uniqueIps} unique source IPs</p>
                </div>
              ) : null}
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {originHeat.map((item) => {
                const intensity = Math.max(18, Math.round((item.count / heatMax) * 100));

                return (
                  <div
                    key={item.countryCode}
                    className="rounded-xl border border-slate-700/80 bg-slate-950/55 p-3"
                  >
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-semibold text-slate-100">{item.countryName}</span>
                      <span className="text-slate-400">{item.count}</span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {item.countryCode} · {item.uniqueIps} unique source IPs
                    </p>
                    <div className="mt-3 h-2 rounded-full bg-slate-800">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-emerald-500 via-amber-400 to-red-500"
                        style={{ width: `${intensity}%` }}
                      />
                    </div>
                  </div>
                );
              })}
              {!originHeat.length && !isLoading ? (
                <div className="col-span-full rounded-xl border border-dashed border-slate-700 px-4 py-8 text-center text-sm text-slate-400">
                  No geographic data for the current filters.
                </div>
              ) : null}
            </div>
          </div>

          <div className="rounded-2xl border border-sky-500/20 bg-[#0b1630]/85 p-5 shadow-[inset_0_1px_0_rgba(148,163,184,0.08)]">
            <h2 className="text-lg font-semibold text-sky-100">Threat Snapshot</h2>
            <p className="mt-2 text-sm text-slate-400">
              Real-time operational stats refreshed every second.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-slate-700/80 bg-slate-950/55 px-3 py-2">
                <p className="text-[11px] text-slate-400">Events / 60s</p>
                <p className="mt-1 text-lg font-semibold text-cyan-200">{liveSnapshot.eps}</p>
              </div>
              <div className="rounded-lg border border-slate-700/80 bg-slate-950/55 px-3 py-2">
                <p className="text-[11px] text-slate-400">Events / 5m</p>
                <p className="mt-1 text-lg font-semibold text-sky-200">{liveSnapshot.last5m}</p>
              </div>
              <div className="rounded-lg border border-slate-700/80 bg-slate-950/55 px-3 py-2">
                <p className="text-[11px] text-slate-400">High Sev / 5m</p>
                <p className="mt-1 text-lg font-semibold text-rose-200">{liveSnapshot.highLast5m}</p>
              </div>
              <div className="rounded-lg border border-slate-700/80 bg-slate-950/55 px-3 py-2">
                <p className="text-[11px] text-slate-400">Active Origins</p>
                <p className="mt-1 text-lg font-semibold text-indigo-200">{liveSnapshot.activeCountries}</p>
              </div>
            </div>

            <div className="mt-3 rounded-lg border border-slate-700/80 bg-slate-950/55 px-3 py-2">
              <p className="text-[11px] text-slate-400">Avg Payload (5m)</p>
              <p className="mt-1 text-sm font-semibold text-slate-200">
                {liveSnapshot.avgPayload.toLocaleString()} bytes
              </p>
            </div>

            <div className="mt-3 rounded-lg border border-slate-700/80 bg-slate-950/55 px-3 py-2">
              <p className="text-[11px] text-slate-400">Stream Health</p>
              <p
                className={`mt-1 text-sm font-semibold ${
                  liveSnapshot.streamHealth === "Healthy" ? "text-emerald-200" : "text-amber-200"
                }`}
              >
                {liveSnapshot.streamHealth}
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-white/15 bg-slate-900/80 p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-white">Recent Alerts</h2>
              <p className="text-sm text-slate-400">
                Latest filtered events, ordered from newest to oldest.
              </p>
            </div>
            <div className="rounded-full border border-amber-400/25 bg-amber-500/10 px-3 py-1 text-xs text-amber-200">
              {Math.min(filteredEvents.length, 5)} shown
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
            {filteredEvents.slice(0, 5).map((event) => (
              <article
                key={event.id}
                className="rounded-xl border border-slate-700/80 bg-slate-950/55 p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-sm text-slate-100">{event.srcIp}</span>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${severityClass(
                      event.severity,
                    )}`}
                  >
                    {event.severity.toUpperCase()}
                  </span>
                </div>
                <p className="mt-2 text-sm text-slate-300">
                  {event.action} via {event.service} on port {event.port}
                </p>
                <p className="mt-3 text-xs text-slate-500">
                  {event.country} · {event.protocol} · {timeAgo(event.timestamp)}
                </p>
              </article>
            ))}
            {!filteredEvents.length && !isLoading ? (
              <div className="rounded-xl border border-dashed border-slate-700 px-4 py-8 text-center text-sm text-slate-400 md:col-span-2 xl:col-span-5">
                No alerts match the current filters.
              </div>
            ) : null}
          </div>
        </section>

        <section className="rounded-2xl border border-sky-500/20 bg-[#0b1630]/85 p-5 shadow-[inset_0_1px_0_rgba(148,163,184,0.08)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-sky-100">Threat Intelligence Summary</h2>
              <p className="text-sm text-slate-400">
                Live behavioral breakdown from currently filtered traffic.
              </p>
            </div>
            <div className="rounded-full border border-sky-300/25 bg-sky-500/10 px-3 py-1 text-xs text-sky-200">
              {intelSummary.total} analyzed events
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
            <div className="rounded-xl border border-slate-700/80 bg-slate-950/55 p-4">
              <h3 className="text-sm font-semibold text-slate-100">Severity Mix</h3>
              <div className="mt-3 space-y-2">
                {([
                  ["High", intelSummary.severityCounts.high, "from-rose-500 to-red-400"],
                  ["Medium", intelSummary.severityCounts.medium, "from-amber-500 to-orange-400"],
                  ["Low", intelSummary.severityCounts.low, "from-emerald-500 to-teal-400"],
                ] as const).map(([label, value, gradient]) => {
                  const width = Math.round((value / intelSummary.total) * 100);

                  return (
                    <div key={label} className="space-y-1">
                      <div className="flex items-center justify-between text-xs text-slate-300">
                        <span>{label}</span>
                        <span>{value}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-slate-800">
                        <div
                          className={`h-full rounded-full bg-gradient-to-r ${gradient}`}
                          style={{ width: `${Math.max(5, width)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="rounded-xl border border-slate-700/80 bg-slate-950/55 p-4">
              <h3 className="text-sm font-semibold text-slate-100">Protocol Pressure</h3>
              <div className="mt-4 space-y-3">
                <div>
                  <div className="flex items-center justify-between text-xs text-slate-300">
                    <span>TCP</span>
                    <span>{intelSummary.tcpPct}%</span>
                  </div>
                  <div className="mt-1 h-2 rounded-full bg-slate-800">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-sky-400"
                      style={{ width: `${Math.max(5, intelSummary.tcpPct)}%` }}
                    />
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between text-xs text-slate-300">
                    <span>UDP</span>
                    <span>{intelSummary.udpPct}%</span>
                  </div>
                  <div className="mt-1 h-2 rounded-full bg-slate-800">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-violet-500 to-indigo-400"
                      style={{ width: `${Math.max(5, intelSummary.udpPct)}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-slate-700/80 bg-slate-950/55 p-4">
              <h3 className="text-sm font-semibold text-slate-100">Top Targeted Services</h3>
              <div className="mt-3 space-y-2">
                {intelSummary.topServices.map((item, index) => {
                  const width = Math.round((item.count / Math.max(1, intelSummary.topServices[0]?.count ?? 1)) * 100);
                  return (
                    <div key={item.service} className="space-y-1">
                      <div className="flex items-center justify-between text-xs text-slate-300">
                        <span className="truncate pr-2">
                          #{index + 1} {item.service}
                        </span>
                        <span>{item.count}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-slate-800">
                        <div
                          className={`h-full rounded-full bg-gradient-to-r ${getRankBarGradient(index)}`}
                          style={{ width: `${Math.max(8, width)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
                {!intelSummary.topServices.length ? (
                  <p className="text-xs text-slate-500">No service data for current filters.</p>
                ) : null}
              </div>
            </div>
          </div>
        </section>

        <section id="live-event-stream" className="rounded-2xl border border-white/15 bg-slate-900/80 p-5">
          <h2 className="text-lg font-semibold text-white">Live Event Stream</h2>
          <p className="mt-1 text-sm text-slate-400">Scroll down in this panel to browse deeper log history.</p>
          <div className="mt-4 max-h-[560px] overflow-auto rounded-xl border border-slate-800/80">
            <table className="w-full min-w-[820px] border-separate border-spacing-y-2 text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="px-3 py-1">Time</th>
                  <th className="px-3 py-1">Source IP</th>
                  <th className="px-3 py-1">Country</th>
                  <th className="px-3 py-1">Protocol</th>
                  <th className="px-3 py-1">Port</th>
                  <th className="px-3 py-1">Service</th>
                  <th className="px-3 py-1">Action</th>
                  <th className="px-3 py-1">Severity</th>
                </tr>
              </thead>
              <tbody>
                {filteredEvents.slice(0, 120).map((event) => (
                  <tr key={event.id} className="bg-slate-950/60">
                    <td className="rounded-l-lg px-3 py-2 text-slate-300">
                      {new Date(event.timestamp).toLocaleTimeString()}
                    </td>
                    <td className="px-3 py-2 font-mono text-slate-200">{event.srcIp}</td>
                    <td className="px-3 py-2 text-slate-300">{event.country}</td>
                    <td className="px-3 py-2 text-slate-200">{event.protocol}</td>
                    <td className="px-3 py-2 font-mono text-cyan-200">:{event.port}</td>
                    <td className="px-3 py-2 text-slate-300">{event.service}</td>
                    <td className="px-3 py-2 text-slate-300">{event.action}</td>
                    <td className="rounded-r-lg px-3 py-2">
                      <span
                        className={`rounded-full border px-2.5 py-1 text-xs font-medium ${severityClass(
                          event.severity,
                        )}`}
                      >
                        {event.severity.toUpperCase()}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </main>
  );
}
