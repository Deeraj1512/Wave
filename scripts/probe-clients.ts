/* Probe extra tokenless clients + fresh-visitor strategy against /player */
const KEY = "AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30";
const VID = "NJAv_7lHUIU";

async function visitor() {
  const html = await (await fetch("https://music.youtube.com/", { headers: { "User-Agent": UA_WEB } })).text();
  return html.match(/"visitorData":"([^"]+)"/)?.[1];
}
const UA_WEB = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0";

const CLIENTS = [
  { name: "ANDROID_NO_SDK", id: "3", version: "21.03.38", ua: "com.google.android.youtube/21.03.38 (Linux; U; Android 14) gzip", extra: {} },
  { name: "ANDROID", id: "3", version: "21.03.38", ua: "com.google.android.youtube/21.03.38 (Linux; U; Android 14) gzip", extra: { osName: "Android", osVersion: "14", androidSdkVersion: "34" } },
  { name: "MWEB", id: "60", version: "2.20260213.01.00", ua: UA_WEB, extra: {} },
  { name: "WEB_EMBEDDED_PLAYER", id: "56", version: "1.20260213.01.00", ua: UA_WEB, extra: {} },
  { name: "IOS", id: "5", version: "21.03.1", ua: "com.google.ios.youtube/21.03.1 (iPhone16,2; U; CPU iOS 18_2 like Mac OS X;)", extra: { osName: "iOS", osVersion: "18.2.22C152", deviceMake: "Apple", deviceModel: "iPhone16,2" } },
];

async function probe(c: (typeof CLIENTS)[0], vis: string | undefined, label: string) {
  try {
    const res = await fetch(`https://music.youtube.com/youtubei/v1/player?key=${KEY}&prettyPrint=false`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Format-Version": "1",
        "X-YouTube-Client-Name": c.id,
        "X-YouTube-Client-Version": c.version,
        "X-Origin": "https://music.youtube.com",
        Referer: "https://music.youtube.com/",
        "User-Agent": c.ua,
        ...(vis ? { "X-Goog-Visitor-Id": vis } : {}),
      },
      body: JSON.stringify({
        context: { client: { clientName: c.name, clientVersion: c.version, gl: "IN", hl: "en", ...(vis ? { visitorData: vis } : {}), ...c.extra } },
        videoId: VID,
        contentCheckOk: true,
        racyCheckOk: true,
      }),
      signal: AbortSignal.timeout(9000),
    });
    const j = await res.json();
    const fmts = j?.streamingData?.adaptiveFormats ?? [];
    const plain = fmts.filter((f: any) => typeof f.url === "string");
    console.log(
      `${label.padEnd(22)} ${String(j?.playabilityStatus?.status).padEnd(16)} fmts=${String(fmts.length).padEnd(3)} plain=${plain.length} ${String(j?.playabilityStatus?.reason ?? "").slice(0, 40)}`
    );
  } catch (e: any) {
    console.log(`${label.padEnd(22)} ERR ${e.message?.slice(0, 50)}`);
  }
}

async function main() {
  const shared = await visitor();
  console.log("shared visitor:", shared?.slice(0, 20) + "…");
  for (const c of CLIENTS) await probe(c, shared, `${c.name}`);
  console.log("--- fresh visitor per call ---");
  for (const c of CLIENTS.slice(0, 2)) await probe(c, await visitor(), `${c.name} (freshVis)`);
}
main();
