// Debug: inspect thumbnail shape in raw search response
const KEY = "AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0";

async function main() {
  // 1. bootstrap visitorData
  const home = await fetch("https://music.youtube.com/", { headers: { "User-Agent": UA } });
  const html = await home.text();
  const visitorData = html.match(/"visitorData":"([^"]+)"/)?.[1];
  const version = html.match(/"INNERTUBE_CONTEXT_CLIENT_VERSION":"([^"]+)"/)?.[1];
  console.log("visitor:", visitorData?.slice(0, 20), "version:", version);

  // 2. search
  const res = await fetch(`https://music.youtube.com/youtubei/v1/search?key=${KEY}&prettyPrint=false`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-YouTube-Client-Name": "67",
      "X-YouTube-Client-Version": version ?? "1.20260213.01.00",
      "X-Origin": "https://music.youtube.com",
      Referer: "https://music.youtube.com/",
      "User-Agent": UA,
      ...(visitorData ? { "X-Goog-Visitor-Id": visitorData } : {}),
    },
    body: JSON.stringify({
      context: { client: { clientName: "WEB_REMIX", clientVersion: version ?? "1.20260213.01.00", gl: "IN", hl: "en", visitorData } },
      query: "kesariya arijit singh",
      params: decodeURIComponent("EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D"),
    }),
  });
  const j = await res.json();

  // 3. find first musicResponsiveListItemRenderer and dump its keys + thumbnail paths
  const items = [];
  (function collect(n, d) {
    if (!n || typeof n !== "object" || d > 15) return;
    if (Array.isArray(n)) return n.forEach((x) => collect(x, d + 1));
    if (n.musicResponsiveListItemRenderer) items.push(n.musicResponsiveListItemRenderer);
    Object.values(n).forEach((v) => collect(v, d + 1));
  })(j, 0);

  console.log("items:", items.length);
  const it = items[0];
  console.log("item keys:", Object.keys(it));
  console.log("item.thumbnail:", JSON.stringify(it.thumbnail ?? null)?.slice(0, 400));
  // search for any 'thumbnail' key anywhere in the item
  const found = [];
  (function hunt(n, path, d) {
    if (!n || typeof n !== "object" || d > 8) return;
    for (const [k, v] of Object.entries(n)) {
      if (/thumbnail/i.test(k)) found.push(path + "." + k);
      hunt(v, path + "." + k, d + 1);
    }
  })(it, "item", 0);
  console.log("thumbnail-ish paths:", found.slice(0, 10));
}
main().catch((e) => { console.error("ERR", e.message); process.exit(1); });
