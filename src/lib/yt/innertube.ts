/**
 * Raw InnerTube session + player calls — ported from Echo Music's InnerTube.kt
 * (ytClient header pattern, player body) to zero-dependency Node fetch.
 *
 * Key ported rules:
 *  - X-Goog-Visitor-Id sent to EVERY client (Echo: VISIONOS/ANDROID_VR 1.65.10 REQUIRE it)
 *  - X-YouTube-Client-Name carries the client ID (not a typo — Echo documents this)
 *  - prettyPrint=false, X-Goog-Api-Format-Version=1, X-Origin/Referer music.youtube.com
 *  - context.visitorData must match the X-Goog-Visitor-Id header
 */
import { createHash } from "node:crypto";
import { API_YTM, INNERTUBE_KEY, ORIGIN_YTM, WEB_REMIX, type InnertubeClient } from "./clients";

const GL = "IN";
const HL = "en";

/**
 * Optional logged-in session (Echo's setLogin path): a burner-account YTM cookie dramatically
 * reduces bot-gating on datacenter IPs. Echo appends SAPISIDHASH Authorization for
 * loginSupported clients — ported here. Set COOKIE in .env to enable.
 */
function loginHeaders(): Record<string, string> {
  const cookie = process.env.COOKIE?.trim();
  if (!cookie) return {};
  const h: Record<string, string> = { Cookie: cookie };
  const sap = cookie.match(/SAPISID=([^;]+)/)?.[1];
  if (sap) {
    const t = Math.floor(Date.now() / 1000);
    const hash = createHash("sha1").update(`${t} ${sap} ${ORIGIN_YTM}`).digest("hex");
    h["Authorization"] = `SAPISIDHASH ${t}_${hash}`;
  }
  return h;
}

let visitorData: string | null = null;
let visitorFetchedAt = 0;
const VISITOR_TTL = 12 * 60 * 60 * 1000; // 12h

export function getVisitorData(): string | null {
  return visitorData && Date.now() - visitorFetchedAt < VISITOR_TTL ? visitorData : visitorData;
}

/** Bootstrap: fetch music.youtube.com and scrape visitorData + live WEB_REMIX version. */
export async function ensureSession(force = false): Promise<string> {
  if (!force && visitorData && Date.now() - visitorFetchedAt < VISITOR_TTL) return visitorData;
  const res = await fetch(ORIGIN_YTM + "/", {
    headers: { "User-Agent": WEB_REMIX.userAgent, "Accept-Language": "en-IN,en;q=0.9" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`bootstrap ${res.status}`);
  const html = await res.text();
  const v = html.match(/"visitorData":"([^"]+)"/)?.[1];
  const live = html.match(/"INNERTUBE_CONTEXT_CLIENT_VERSION":"([^"]+)"/)?.[1];
  if (live) WEB_REMIX.version = live;
  if (!v) throw new Error("visitorData not found in bootstrap");
  visitorData = v;
  visitorFetchedAt = Date.now();
  return v;
}

function clientContext(c: InnertubeClient) {
  return {
    client: {
      clientName: c.name,
      clientVersion: c.version,
      ...(c.osName ? { osName: c.osName } : {}),
      ...(c.osVersion ? { osVersion: c.osVersion } : {}),
      ...(c.deviceMake ? { deviceMake: c.deviceMake } : {}),
      ...(c.deviceModel ? { deviceModel: c.deviceModel } : {}),
      ...(c.androidSdkVersion ? { androidSdkVersion: c.androidSdkVersion } : {}),
      gl: GL,
      hl: HL,
      visitorData: visitorData ?? undefined,
    },
  };
}

function ytHeaders(c: InnertubeClient): Record<string, string> {
  const h: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Goog-Api-Format-Version": "1",
    "X-YouTube-Client-Name": c.id,
    "X-YouTube-Client-Version": c.version,
    "X-Origin": ORIGIN_YTM,
    Referer: ORIGIN_YTM + "/",
    "User-Agent": c.userAgent,
    "Accept-Language": "en-IN,en;q=0.9",
  };
  if (visitorData) h["X-Goog-Visitor-Id"] = visitorData;
  return { ...h, ...loginHeaders() };
}

export interface PlayerFormat {
  itag: number;
  url?: string;
  mimeType?: string;
  bitrate?: number;
  contentLength?: number;
  audioQuality?: string;
  signatureCipher?: string;
  cipher?: string;
}

export interface PlayerResult {
  ok: boolean;
  status?: string;
  reason?: string;
  formats: PlayerFormat[];
  expiresInSeconds?: number;
  title?: string;
  author?: string;
  lengthSeconds?: number;
  musicVideoType?: string;
  videoId?: string;
}

interface PlayerBody {
  context: object;
  videoId: string;
  playbackContext?: {
    contentPlaybackContext: { signatureTimestamp: number };
  };
  serviceIntegrityDimensions?: { poToken: string };
  contentCheckOk?: boolean;
  racyCheckOk?: boolean;
}

/** Raw /player call for one client. Never throws for HTTP-level issues — returns a result. */
export async function player(c: InnertubeClient, videoId: string, timeoutMs = 9000): Promise<PlayerResult> {
  try {
    await ensureSession();
    const body: PlayerBody = {
      context: clientContext(c),
      videoId,
      contentCheckOk: true,
      racyCheckOk: true,
    };
    const res = await fetch(`${API_YTM}/player?key=${INNERTUBE_KEY}&prettyPrint=false`, {
      method: "POST",
      headers: ytHeaders(c),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return { ok: false, reason: `http ${res.status}`, formats: [] };
    const j = (await res.json()) as Record<string, any>;
    const sd = j.streamingData;
    const formats: PlayerFormat[] = (sd?.adaptiveFormats ?? []).map((f: any) => ({
      itag: f.itag,
      url: f.url,
      mimeType: f.mimeType,
      bitrate: f.bitrate,
      contentLength: f.contentLength ? Number(f.contentLength) : undefined,
      audioQuality: f.audioQuality,
      signatureCipher: f.signatureCipher,
      cipher: f.cipher,
    }));
    const vd = j.videoDetails;
    return {
      ok: j.playabilityStatus?.status === "OK",
      status: j.playabilityStatus?.status,
      reason: j.playabilityStatus?.reason,
      formats,
      expiresInSeconds: sd?.expiresInSeconds,
      title: vd?.title,
      author: vd?.author,
      lengthSeconds: vd?.lengthSeconds ? Number(vd.lengthSeconds) : undefined,
      musicVideoType: vd?.musicVideoType,
      videoId: vd?.videoId,
    };
  } catch (e: any) {
    return { ok: false, reason: e?.message ?? "player failed", formats: [] };
  }
}

/** Ensure session is bootstrapped before search too. */
export async function sessionReady() {
  await ensureSession();
}

export { clientContext, ytHeaders };
