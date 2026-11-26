"use client";

/**
 * Batch 2 onboarding — login → languages → favorite artists, with REAL artist
 * photos in the pick grid (the artistPhoto face fix powers these circles).
 *
 * Opens automatically on first run (nothing saved yet) or again via the
 * wave:open-profile event (Library → "Your taste" → retake, prefilled).
 * Save writes wave.profile.v1 (src/lib/profile.ts) — the feed, search ranking
 * and radio familiar-boost all read from it immediately afterwards.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, Music2, Search, Sparkles } from "lucide-react";
import { artistImage, onboardArtists } from "@/lib/artistCatalog";
import {
  ONBOARDING_LANGS,
  OPEN_PROFILE_EVENT,
  getProfile,
  markProfileOpened,
  saveProfile,
} from "@/lib/profile";
import type { Lang } from "@/lib/types";
import { cn } from "@/lib/utils";

type Step = 0 | 1 | 2;

/** One artist circle with its lazily-resolved face (cached in localStorage by artistImage). */
function ArtistCircle({
  name,
  selected,
  onToggle,
}: {
  name: string;
  selected: boolean;
  onToggle: () => void;
}) {
  const [img, setImg] = useState<string | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    artistImage(name)
      .then((u) => alive && setImg(u))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [name]);
  return (
    <button
      onClick={onToggle}
      className="flex w-[68px] shrink-0 flex-col items-center gap-1.5"
      aria-pressed={selected}
      aria-label={`${selected ? "Remove" : "Add"} ${name}`}
    >
      <span
        className={cn(
          "relative flex h-[68px] w-[68px] items-center justify-center overflow-hidden rounded-full border-2 transition",
          selected ? "border-[var(--accent)] shadow-[0_0_0_3px_rgba(245,243,239,0.15)]" : "border-border"
        )}
      >
        {img ? (
          <img src={img} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <Music2 className="h-6 w-6 text-muted-foreground/60" />
        )}
        {selected && (
          <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/45">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--accent)]">
              <Check className="h-3.5 w-3.5 text-black" />
            </span>
          </span>
        )}
      </span>
      <span className="w-full truncate text-center text-[11px] leading-tight text-foreground/80">{name}</span>
    </button>
  );
}

export function Onboarding({ onDone }: { onDone: () => void }) {
  const saved = useMemo(() => getProfile(), []);
  const [step, setStep] = useState<Step>(0);
  const [name, setName] = useState(saved?.name && saved.name !== "Listener" ? saved.name : "");
  const [langs, setLangs] = useState<Lang[]>(saved?.langs ?? []);
  const [artists, setArtists] = useState<Record<string, Lang>>(() => {
    const m: Record<string, Lang> = {};
    for (const a of saved?.artists ?? []) m[a.name] = a.lang;
    return m;
  });
  const [activeLang, setActiveLang] = useState<Lang | undefined>(saved?.langs?.[0]);
  const [addQ, setAddQ] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);

  // auto-focus the name box once visible
  useEffect(() => {
    if (step === 0) {
      const id = setTimeout(() => nameRef.current?.focus(), 150);
      return () => clearTimeout(id);
    }
  }, [step]);

  // keep the artist tab on a language that still exists
  useEffect(() => {
    if (step !== 2) return;
    if (!activeLang || !langs.includes(activeLang)) setActiveLang(langs[0]);
  }, [step, langs, activeLang]);

  const toggleLang = (l: Lang) =>
    setLangs((prev) => (prev.includes(l) ? prev.filter((x) => x !== l) : [...prev, l]));

  const toggleArtist = (artist: string, lang: Lang) =>
    setArtists((prev) => {
      const m = { ...prev };
      if (m[artist] !== undefined) delete m[artist];
      else m[artist] = lang;
      return m;
    });

  const addCustom = () => {
    const nm = addQ.trim();
    if (!nm.length) return;
    const lang = activeLang ?? langs[0];
    if (!lang) return;
    setArtists((prev) => (prev[nm] !== undefined ? prev : { ...prev, [nm]: lang }));
    setAddQ("");
  };

  const artistCount = Object.keys(artists).length;

  const finish = useCallback(
    (skip: boolean) => {
      markProfileOpened();
      saveProfile({
        name: name.trim() || "Listener",
        langs,
        artists: Object.entries(artists).map(([artistName, lang]) => ({ name: artistName, lang })),
        skipped: skip,
      });
      onDone();
    },
    [artists, langs, name, onDone]
  );

  // retake from inside the app — the Save button is the only exit
  const retake = !!saved;

  return (
    <div className="fixed inset-0 z-[60] flex flex-col overflow-y-auto bg-[var(--bg)] text-foreground" role="dialog" aria-label="Welcome to Wave">
      <div className="mx-auto flex min-h-full w-full max-w-lg flex-col px-6 py-8">
        {/* progress */}
        <div className="mb-8 flex items-center gap-2">
          {step > 0 && (
            <button
              onClick={() => setStep((s) => (s - 1) as Step)}
              className="mr-1 flex h-9 w-9 items-center justify-center rounded-full bg-surface-2 transition hover:bg-surface-3"
              aria-label="Back"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
          )}
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className={cn(
                "h-1.5 rounded-full transition-all",
                i === step ? "w-6 bg-[var(--accent)]" : "w-1.5 bg-foreground/25"
              )}
            />
          ))}
          <span className="ml-auto flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5" /> {artistCount} artist{artistCount === 1 ? "" : "s"}
          </span>
        </div>

        {step === 0 && (
          <div className="flex flex-1 flex-col">
            <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--accent)]">
              <img src="/wave-mark.png" alt="" className="h-9 w-9" />
            </div>
            <h1 className="text-center text-3xl font-black tracking-tight">Welcome to Wave</h1>
            <p className="mt-2 text-center text-sm text-muted-foreground">
              Your music, your taste. Three quick steps and your feed is yours.
            </p>
            <label className="mt-10 block text-sm font-semibold" htmlFor="wave-name">
              What should we call you?
            </label>
            <input
              id="wave-name"
              ref={nameRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && name.trim()) setStep(1);
              }}
              placeholder="Your name"
              maxLength={30}
              className="mt-2 w-full rounded-2xl bg-surface-2 px-4 py-3.5 text-[15px] font-medium outline-none transition focus:bg-surface-3"
            />
            <div className="mt-auto pt-8">
              <button
                onClick={() => setStep(1)}
                className="w-full rounded-full bg-[var(--accent)] py-3.5 text-sm font-bold text-black transition hover:bg-white"
              >
                Continue
              </button>
              {retake && (
                <button onClick={onDone} className="mt-3 w-full py-2 text-sm font-medium text-muted-foreground hover:text-foreground">
                  Cancel — keep my current taste
                </button>
              )}
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="flex flex-1 flex-col">
            <h1 className="text-3xl font-black tracking-tight">Your languages</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Pick every language you listen to — the one you love most first. Your feed,
              search and queues stay inside them; other languages only trickle in one or
              two songs at a time, never forced.
            </p>
            <div className="mt-7 flex flex-wrap gap-2.5">
              {ONBOARDING_LANGS.map((l) => {
                const idx = langs.indexOf(l);
                const on = idx >= 0;
                return (
                  <button
                    key={l}
                    onClick={() => toggleLang(l)}
                    aria-pressed={on}
                    className={cn(
                      "flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold transition",
                      on
                        ? "bg-[var(--accent)] text-black"
                        : "bg-surface-2 text-foreground/85 hover:bg-surface-3"
                    )}
                  >
                    {on && <span className="text-xs font-black opacity-70">{idx + 1}</span>}
                    {l}
                  </button>
                );
              })}
            </div>
            <p className="mt-4 text-xs text-muted-foreground" aria-live="polite">
              {langs.length === 0
                ? "Pick at least one language to continue"
                : `${langs.length} language${langs.length === 1 ? "" : "s"} · ${langs.join(" → ")}`}
            </p>
            <div className="mt-auto pt-8">
              <button
                disabled={langs.length === 0}
                onClick={() => setStep(2)}
                className="w-full rounded-full bg-[var(--accent)] py-3.5 text-sm font-bold text-black transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                Continue
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-1 flex-col">
            <h1 className="text-3xl font-black tracking-tight">Your artists</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Tap the faces you love — aim for a handful per language. Your queues will
              vibe with them from the very first play.
            </p>

            {/* language tabs */}
            <div className="no-scrollbar mt-5 flex gap-2 overflow-x-auto pb-1">
              {langs.map((l) => (
                <button
                  key={l}
                  onClick={() => setActiveLang(l)}
                  className={cn(
                    "shrink-0 rounded-full px-4 py-1.5 text-[13px] font-bold transition",
                    activeLang === l
                      ? "bg-[var(--accent)] text-black"
                      : "bg-surface-2 text-foreground/80 hover:bg-surface-3"
                  )}
                >
                  {l}
                </button>
              ))}
            </div>

            {/* add-any-artist search */}
            <div className="mt-3 flex items-center gap-2 rounded-2xl bg-surface-2 px-4 py-2.5">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
              <input
                value={addQ}
                onChange={(e) => setAddQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addCustom();
                }}
                placeholder={`Add any ${activeLang ?? ""} artist by name…`}
                className="w-full bg-transparent text-sm font-medium outline-none placeholder:text-muted-foreground"
                aria-label="Add artist by name"
              />
              {addQ.trim() && (
                <button onClick={addCustom} className="shrink-0 rounded-full bg-[var(--accent)] px-3 py-1 text-xs font-bold text-black">
                  Add
                </button>
              )}
            </div>

            {/* candidate grid — real faces, lazily resolved */}
            <div className="mt-5 grid grid-cols-4 gap-x-2 gap-y-4 sm:grid-cols-5">
              {onboardArtists(activeLang ?? "Hindi").map((a) => (
                <ArtistCircle
                  key={a}
                  name={a}
                  selected={artists[a] !== undefined}
                  onToggle={() => toggleArtist(a, activeLang ?? langs[0])}
                />
              ))}
              {/* the user's own additions for THIS language */}
              {Object.entries(artists)
                .filter(([a, lang]) => lang === activeLang && !onboardArtists(activeLang ?? "Hindi").includes(a))
                .map(([a]) => (
                  <ArtistCircle key={a} name={a} selected onToggle={() => toggleArtist(a, activeLang ?? langs[0])} />
                ))}
            </div>

            <div className="mt-auto pt-8">
              <button
                onClick={() => finish(false)}
                className="w-full rounded-full bg-[var(--accent)] py-3.5 text-sm font-bold text-black transition hover:bg-white"
              >
                {artistCount > 0 ? `Done — ${artistCount} favorite${artistCount === 1 ? "" : "s"}` : "Done"}
              </button>
              {!retake && (
                <button onClick={() => finish(true)} className="mt-3 w-full py-2 text-sm font-medium text-muted-foreground hover:text-foreground">
                  Skip for now — I&apos;ll set taste later
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** External store shape for page.tsx: gate + open event in one hook. */
export function useOnboardingGate(): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(false);
  const checked = useRef(false);

  useEffect(() => {
    if (!checked.current) {
      checked.current = true;
      // first run, nothing saved AND never seen → open once
      if (!getProfile() && typeof window !== "undefined") {
        try {
          if (localStorage.getItem("wave.profile.opened") !== "1") setOpen(true);
        } catch {
          /* private mode */
        }
      }
    }
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_PROFILE_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_PROFILE_EVENT, onOpen);
  }, []);

  const set = useCallback((v: boolean) => setOpen(v), []);
  return [open, set];
}
