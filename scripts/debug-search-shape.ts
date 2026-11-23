/* Debug: inspect raw search item structure */
async function main() {
  const boot = await fetch("https://music.youtube.com/", {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0" },
  });
  const html = await boot.text();
  const visitorData = html.match(/"visitorData":"([^"]+)"/)?.[1];
  const live = html.match(/"INNERTUBE_CONTEXT_CLIENT_VERSION":"([^"]+)"/)?.[1];

  const res = await fetch(
    "https://music.youtube.com/youtubei/v1/search?key=AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30&prettyPrint=false",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-YouTube-Client-Name": "67",
        "X-YouTube-Client-Version": live ?? "1.20260213.01.00",
        "X-Origin": "https://music.youtube.com",
        Referer: "https://music.youtube.com/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0",
        "X-Goog-Visitor-Id": visitorData,
      },
      body: JSON.stringify({
        context: { client: { clientName: "WEB_REMIX", clientVersion: live ?? "1.20260213.01.00", gl: "IN", hl: "en", visitorData } },
        query: "kesariya",
        params: decodeURIComponent("EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D"),
      }),
    }
  );
  const j = await res.json();
  const items: any[] = [];
  (function collect(n: any, d: number) {
    if (!n || typeof n !== "object" || d > 15) return;
    if (Array.isArray(n)) return n.forEach((x: any) => collect(x, d + 1));
    if (n.musicResponsiveListItemRenderer) items.push(n.musicResponsiveListItemRenderer);
    Object.values(n).forEach((v: any) => collect(v, d + 1));
  })(j, 0);
  console.log("items:", items.length);
  const it = items[0];
  console.log(JSON.stringify({ flex: it.flexColumns?.map((c: any) => c.musicResponsiveListItemFlexColumnRenderer?.text), fixed: it.fixedColumns?.map((c: any) => c.musicResponsiveListItemFixedColumnRenderer?.text) }, null, 1).slice(0, 2400));
}
main();
