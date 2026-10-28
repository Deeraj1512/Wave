export type Lang = "Hindi" | "Tamil" | "Telugu" | "Punjabi" | "Kannada" | "Malayalam" | "Bengali" | "English";

export interface Track {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number; // seconds
  lang?: Lang; // known for seed catalog; parsed from explicit "(Hindi)"-style markers for live results
  year: number;
  plays: string; // e.g. "812M"
  colors: [string, string]; // gradient cover stops
  movie?: string;
  /** real album art URL (YTM thumbnail) when resolved */
  cover?: string;
}

export interface Artist {
  id: string;
  name: string;
  tag: string;
  colors: [string, string];
}

export type Screen =
  | { name: "home" }
  | { name: "explore" }
  | { name: "search" }
  | { name: "library" }
  | { name: "playlist"; id: string };
