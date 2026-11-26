/**
 * InnerTube client catalog — ported from Echo Music (github.com/EchoMusicApp/Echo-Music),
 * file: innertube/src/main/kotlin/com/music/innertube/models/YouTubeClient.kt
 *
 * Echo's measured findings (documented in their code):
 *  - IOS / IPADOS / old ANDROID_VR stream URLs are ~1 MiB PREVIEWS: googlevideo serves a fixed
 *    byte prefix and 403s everything past it (playback dies at 30–90s).
 *  - VISIONOS is the only client measured to serve COMPLETE files (100% 206 across 51 ranged
 *    reads over 300s). It leads the chain.
 *  - ANDROID_VR 1.65.10 is the current yt-dlp/YouTube.js pin; whole-file capable. Older versions
 *    (1.43.32 / 1.61.48) are bot-gated SERVER-SIDE by client version.
 *  - X-Goog-Visitor-Id must be sent to EVERY client (even loginSupported=false ones) — VISIONOS
 *    and ANDROID_VR 1.65.10 REQUIRE it and answer UNPLAYABLE/LOGIN_REQUIRED without it.
 *  - No PO tokens needed for the tokenless mobile catalog (Echo's PoTokenProvider is a stub).
 */

export interface InnertubeClient {
  name: string;
  version: string;
  id: string;
  userAgent: string;
  osName?: string;
  osVersion?: string;
  deviceMake?: string;
  deviceModel?: string;
  androidSdkVersion?: string;
  /** Expected to return a fully readable stream URL (whole file). */
  plainUrl: boolean;
  /** Preview-capped clients are last resorts only. */
  preview?: boolean;
}

export const UA_WEB = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0";

export const ORIGIN_YTM = "https://music.youtube.com";
export const API_YTM = `${ORIGIN_YTM}/youtubei/v1`;
/** Public InnerTube key used by YouTube Music web — a well-known constant. */
export const INNERTUBE_KEY = "AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30";

export const WEB_REMIX: InnertubeClient = {
  name: "WEB_REMIX",
  version: "1.20260213.01.00",
  id: "67",
  userAgent: UA_WEB,
  plainUrl: false,
};

/**
 * VISIONOS — Echo's lead client: complete files, plain URLs, tokenless.
 */
export const VISIONOS: InnertubeClient = {
  name: "VISIONOS",
  version: "0.1",
  id: "101",
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  osName: "visionOS",
  osVersion: "1.3.21O771",
  deviceMake: "Apple",
  deviceModel: "RealityDevice14,1",
  plainUrl: true,
};

/** Current ANDROID_VR pin — byte-for-byte the values yt-dlp and YouTube.js pin. */
export const ANDROID_VR_1_65_10: InnertubeClient = {
  name: "ANDROID_VR",
  version: "1.65.10",
  id: "28",
  userAgent:
    "com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip",
  osName: "Android",
  osVersion: "12L",
  deviceMake: "Oculus",
  deviceModel: "Quest 3",
  androidSdkVersion: "32",
  plainUrl: true,
};

export const TVHTML5: InnertubeClient = {
  name: "TVHTML5",
  version: "7.20260213.00.00",
  id: "7",
  userAgent:
    "Mozilla/5.0(SMART-TV; Linux; Tizen 4.0.0.2) AppleWebkit/605.1.15 (KHTML, like Gecko) SamsungBrowser/9.2 TV Safari/605.1.15",
  plainUrl: false,
};

export const IPADOS: InnertubeClient = {
  name: "IOS",
  version: "21.03.3",
  id: "5",
  userAgent:
    "com.google.ios.youtube/21.03.3 (iPad7,6; U; CPU iPadOS 17_7_10 like Mac OS X; en-US)",
  osName: "iPadOS",
  osVersion: "17.7.10.21H450",
  deviceMake: "Apple",
  deviceModel: "iPad7,6",
  plainUrl: true,
  preview: true,
};

export const IOS: InnertubeClient = {
  name: "IOS",
  version: "21.03.1",
  id: "5",
  userAgent: "com.google.ios.youtube/21.03.1 (iPhone16,2; U; CPU iOS 18_2 like Mac OS X;)",
  osVersion: "18.2.22C152",
  plainUrl: true,
  preview: true,
};

/**
 * Echo's measured fallback order (YTPlayerUtils.STREAM_FALLBACK_CLIENTS):
 * VISIONOS → ANDROID_VR_1_65_10 → TVHTML5 → (ANDROID_VR_1_43_32 control) → IPADOS → IOS.
 * TVHTML5 needs web PO tokens we don't mint server-side, so it's included but expected to yield
 * no plain URL; preview clients are strictly last resort.
 */
export const STREAM_CHAIN: InnertubeClient[] = [VISIONOS, ANDROID_VR_1_65_10, TVHTML5, IPADOS, IOS];
