import { catalogNow } from "../src/lib/catalog";
import { inferLiveLang, detectTrackLang } from "../src/lib/langs";

const c = catalogNow();
console.log("catalog size:", c?.length ?? 0);
if (c && c.length > 0) {
  const sample = c.slice(0, 3).map((t) => ({ movie: t.movie, lang: t.lang, artist: t.artist.split(",")[0] }));
  console.log(JSON.stringify(sample));
  const sai = c.filter((t) => t.artist.includes("Sai Abhyankkar"));
  console.log("Sai Abhyankkar catalog rows:", sai.length, sai.slice(0, 2).map((t) => `${t.title} / ${t.movie} / ${t.lang}`));
}
console.log("infer Sai Abhyankkar row:", inferLiveLang({ title: "Veezha Veera", album: "O.M: Operation Mole", artist: "Sai Abhyankkar, Tippu & Arun Srinivasan" }));
console.log("infer K S Harisankar row:", inferLiveLang({ title: "Pavizha Mazha", album: "Athiran", artist: "K S Harisankar" }));
console.log("detect explicit/script:", detectTrackLang({ title: 'Veezha Veera (From "O.M: Operation Mole")' }));
