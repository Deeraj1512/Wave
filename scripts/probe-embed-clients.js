// Probe embed-pipeline InnerTube clients from the server (bot-wall bypass candidates):
//   TVHTML5_SIMPLY_EMBEDDED_PLAYER (85), WEB_EMBEDDED_PLAYER (56), MWEB (2)
// These ride YouTube's official embed pipeline — historically not IP-bot-gated like /player web.
const KEY = "AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0";
const VIDEO = "7uSj-x6EIUE"; // Dilbar

async function bootstrap() {
  const home = await fetch("https://music.youtube.com/", { headers: { "User-Agent": UA } });
  const html = await home.text();
  return {
    visitorData: html.match(/"visitorData":"([^"]+)"/)?.[1],
    version: html.match(/"INNERTUBE_CONTEXT_CLIENT_VERSION":"([^"]+)"/)?.[1],
  };
}

async function probeClient(name, id, version, ctx, visitorData, extraBody = {}) {
  const res = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${KEY}&prettyPrint=false`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-YouTube-Client-Name": String(id),
      "X-YouTube-Client-Version": version,
      "X-Origin": "https://www.youtube.com",
      Referer: "https://www.youtube.com/",
      "User-Agent": UA,
      ...(visitorData ? { "X-Goog-Visitor-Id": visitorData } : {}),
    },
    body: JSON.stringify({
      context: { client: { clientName: name, clientVersion: version, gl: "IN", hl: "en", visitorData, ...ctx } },
      videoId: VIDEO,
      contentCheckOk: true,
      racyCheckOk: true,
      ...extraBody,
    }),
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) return { name, http: res.status };
  const j = await res.json();
  const status = j.playabilityStatus?.status;
  const fmts = j.streamingData?.adaptiveFormats ?? [];
  const audio = fmts.filter((f) => (f.mimeType ?? "").startsWith("audio/") && f.url);
  let probeNote = "";
  if (audio.length > 0) {
    try {
      const r = await fetch(audio[0].url, { headers: { "User-Agent": UA, Range: "bytes=0-1023" }, signal: AbortSignal.timeout(10000) });
      probeNote = `stream:${r.status}`;
      r.body?.cancel().catch(() => {});
    } catch (e) {
      probeNote = `stream-err:${e.message.slice(0, 30)}`;
    }
  }
  return {
    name,
    status,
    reason: j.playabilityStatus?.reason?.slice(0, 60),
    formats: fmts.length,
    audioUrls: audio.length,
    probe: probeNote,
    cipher: fmts.some((f) => f.signatureCipher || f.cipher),
  };
}

async function main() {
  const { visitorData, version } = await bootstrap();
  console.log("visitor:", visitorData?.slice(0, 16), "webRemix:", version);

  const tests = [
    ["TVHTML5_SIMPLY_EMBEDDED_PLAYER", "85", "2.0", { html5Preference: "HTML5_PREF_WANTS" }, { thirdParty: { embedUrl: "https://www.youtube.com/" } }],
    ["WEB_EMBEDDED_PLAYER", "56", version ?? "1.20261020.10.00", {}, { thirdParty: { embedUrl: "https://www.youtube.com/" } }],
    ["MWEB", "2", "2.20261020.10.00", {}, {}],
  ];
  for (const [name, id, ver, ctx, extra] of tests) {
    try {
      const r = await probeClient(name, id, ver, ctx, visitorData, extra);
      console.log(JSON.stringify(r));
    } catch (e) {
      console.log(JSON.stringify({ name, err: e.message.slice(0, 60) }));
    }
  }
}
main().catch((e) => { console.error("ERR", e.message); process.exit(1); });
