import { randomUUID } from "node:crypto";

export type Severity = "low" | "medium" | "high";
export type Protocol = "TCP" | "UDP";

export type HoneypotEvent = {
  id: string;
  timestamp: string;
  srcIp: string;
  country: string;
  protocol: Protocol;
  port: number;
  service: string;
  severity: Severity;
  action: string;
  payloadSize: number;
};

type IncomingEvent = Partial<HoneypotEvent> & {
  srcIp?: string;
  port?: number;
  eventid?: string;
  src_ip?: string;
  src_port?: number;
  dst_port?: number;
  protocol?: string;
  timestamp?: string;
  message?: string;
};

const MAX_EVENTS = 2000;
const INITIAL_EVENTS = 140;

const countries = ["CN", "RU", "US", "BR", "DE", "IN", "NL", "IR", "VN", "FR"];
const services = ["SSH", "HTTP", "HTTPS", "RDP", "MySQL", "Redis", "SMB", "Telnet"];
const actions = [
  "Auth attempt",
  "Port scan",
  "Exploit probe",
  "Brute force burst",
  "Malware fetch",
];
const targetPorts = [22, 23, 80, 443, 445, 3389, 3306, 6379, 8080, 5432];

let feed: HoneypotEvent[] = seedEvents();
type FeedListener = (event: HoneypotEvent) => void;

const listeners = new Set<FeedListener>();
let syntheticLoopStarted = false;
let syntheticLoopHandle: ReturnType<typeof setInterval> | null = null;

function randomFrom<T>(items: T[]): T {
  const index = Math.floor(Math.random() * items.length);
  return items[index];
}

function randomIp(): string {
  const octet = () => Math.floor(Math.random() * 255);
  return `${octet()}.${octet()}.${octet()}.${octet()}`;
}

export function inferSeverity(port: number): Severity {
  if (port === 22 || port === 3389 || port === 445) {
    return Math.random() > 0.42 ? "high" : "medium";
  }

  if (port === 80 || port === 443 || port === 8080) {
    return Math.random() > 0.7 ? "high" : "medium";
  }

  return Math.random() > 0.8 ? "medium" : "low";
}

function normalizeProtocol(raw: unknown): Protocol {
  if (typeof raw === "string" && raw.toUpperCase() === "UDP") {
    return "UDP";
  }

  return "TCP";
}

function toNumber(raw: unknown, fallback: number): number {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.round(raw);
  }

  if (typeof raw === "string") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) {
      return Math.round(parsed);
    }
  }

  return fallback;
}

export function cowrieToEvent(raw: IncomingEvent): HoneypotEvent {
  const inferredPort = toNumber(raw.dst_port ?? raw.port ?? raw.src_port, 22);
  const actionText =
    (typeof raw.message === "string" && raw.message) ||
    (typeof raw.eventid === "string" && raw.eventid) ||
    "Cowrie event";

  return {
    id: raw.id ?? randomUUID(),
    timestamp: raw.timestamp ?? new Date().toISOString(),
    srcIp: raw.src_ip ?? raw.srcIp ?? randomIp(),
    country: raw.country ?? "UN",
    protocol: normalizeProtocol(raw.protocol),
    port: inferredPort,
    service: raw.service ?? (inferredPort === 22 ? "SSH" : "Unknown"),
    severity:
      raw.severity === "high" || raw.severity === "medium" || raw.severity === "low"
        ? raw.severity
        : inferSeverity(inferredPort),
    action: actionText,
    payloadSize: toNumber(raw.payloadSize, Math.floor(Math.random() * 1200) + 60),
  };
}

function standardToEvent(raw: IncomingEvent): HoneypotEvent {
  const now = new Date();
  const safePort = Number.isInteger(raw.port) ? Number(raw.port) : 22;

  return {
    id: raw.id ?? randomUUID(),
    timestamp: raw.timestamp ?? now.toISOString(),
    srcIp: raw.srcIp ?? randomIp(),
    country: raw.country ?? "UN",
    protocol: normalizeProtocol(raw.protocol),
    port: safePort,
    service: raw.service ?? "Unknown",
    severity:
      raw.severity === "high" || raw.severity === "medium" || raw.severity === "low"
        ? raw.severity
        : inferSeverity(safePort),
    action: raw.action ?? "Custom event",
    payloadSize:
      typeof raw.payloadSize === "number" && raw.payloadSize > 0
        ? raw.payloadSize
        : Math.floor(Math.random() * 1500) + 60,
  };
}

export function normalizeIncomingEvent(raw: IncomingEvent): HoneypotEvent {
  const isCowrie = typeof raw.eventid === "string" || typeof raw.src_ip === "string";
  return isCowrie ? cowrieToEvent(raw) : standardToEvent(raw);
}

function buildSyntheticEvent(at: Date): HoneypotEvent {
  const port = randomFrom(targetPorts);

  return {
    id: randomUUID(),
    timestamp: at.toISOString(),
    srcIp: randomIp(),
    country: randomFrom(countries),
    protocol: Math.random() > 0.2 ? "TCP" : "UDP",
    port,
    service: randomFrom(services),
    severity: inferSeverity(port),
    action: randomFrom(actions),
    payloadSize: Math.floor(Math.random() * 1900) + 80,
  };
}

function seedEvents(): HoneypotEvent[] {
  const now = Date.now();
  const seeded: HoneypotEvent[] = [];

  for (let i = 0; i < INITIAL_EVENTS; i += 1) {
    const offsetMs = i * 1200;
    seeded.unshift(buildSyntheticEvent(new Date(now - offsetMs)));
  }

  return seeded;
}

export function appendSyntheticTraffic(): void {
  const burst = Math.random() > 0.75 ? 3 : Math.random() > 0.35 ? 2 : 1;

  for (let i = 0; i < burst; i += 1) {
    const event = buildSyntheticEvent(new Date());
    feed.unshift(event);
    notifyListeners(event);
  }

  if (feed.length > MAX_EVENTS) {
    feed = feed.slice(0, MAX_EVENTS);
  }
}

function notifyListeners(event: HoneypotEvent): void {
  for (const listener of listeners) {
    listener(event);
  }
}

export function ingestEvents(payload: IncomingEvent | IncomingEvent[]): HoneypotEvent[] {
  const incoming = Array.isArray(payload) ? payload : [payload];
  const normalized = incoming.map(normalizeIncomingEvent);

  feed = [...normalized, ...feed].slice(0, MAX_EVENTS);
  for (const event of normalized) {
    notifyListeners(event);
  }
  return normalized;
}

export function getFeed(limit = 120): HoneypotEvent[] {
  const safeLimit = Math.min(Math.max(limit, 1), MAX_EVENTS);
  return feed.slice(0, safeLimit);
}

export function subscribeToFeed(listener: FeedListener): () => void {
  listeners.add(listener);
  startSyntheticLoop();

  return () => {
    listeners.delete(listener);
  };
}

export function startSyntheticLoop(): void {
  if (syntheticLoopStarted) {
    return;
  }

  syntheticLoopStarted = true;
  syntheticLoopHandle = setInterval(() => {
    appendSyntheticTraffic();
  }, 3000);
}

export function stopSyntheticLoop(): void {
  if (syntheticLoopHandle) {
    clearInterval(syntheticLoopHandle);
    syntheticLoopHandle = null;
    syntheticLoopStarted = false;
  }
}
