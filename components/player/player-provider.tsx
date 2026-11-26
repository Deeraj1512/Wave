"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { audioSrc, Track } from "@/lib/api";

interface PlayerState {
  queue: Track[];
  index: number;
  current: Track | null;
  isPlaying: boolean;
  time: number;
  duration: number;
  volume: number;
  playList: (tracks: Track[], startIndex?: number) => void;
  toggle: () => void;
  seek: (sec: number) => void;
  next: () => void;
  prev: () => void;
  jumpTo: (i: number) => void;
  addToQueue: (t: Track) => void;
  setVolume: (v: number) => void;
}

const PlayerContext = createContext<PlayerState | null>(null);

export function usePlayer() {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayer must be used inside PlayerProvider");
  return ctx;
}

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const { toast } = useToast();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const queueRef = useRef<Track[]>([]);
  const indexRef = useRef(0);
  const [queue, setQueue] = useState<Track[]>([]);
  const [index, setIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(1);

  const load = useCallback(
    (tracks: Track[], start: number) => {
      if (!tracks.length) return;
      queueRef.current = tracks;
      indexRef.current = start;
      setQueue(tracks);
      setIndex(start);
      const a = audioRef.current;
      const t = tracks[start];
      if (!a || !t) return;
      a.src = audioSrc(t.videoId);
      a.play().catch(() => setIsPlaying(false));
      if ("mediaSession" in navigator) {
        try {
          navigator.mediaSession.metadata = new MediaMetadata({
            title: t.title,
            artist: t.artist ?? "",
            album: t.album ?? "",
            artwork: t.thumb ? [{ src: t.thumb, sizes: "512x512" }] : [],
          });
        } catch {}
      }
    },
    []
  );

  useEffect(() => {
    const a = new Audio();
    a.preload = "metadata";
    audioRef.current = a;

    const onTime = () => setTime(a.currentTime);
    const onMeta = () => setDuration(a.duration || 0);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => {
      const nextIdx = indexRef.current + 1;
      if (nextIdx < queueRef.current.length) load(queueRef.current, nextIdx);
      else setIsPlaying(false);
    };
    const onError = () => {
      if (!a.src) return;
      setIsPlaying(false);
      toast({
        title: "Playback unavailable",
        description: "The stream for this track could not be loaded. The backend may need a login cookie (see deployment notes).",
        variant: "destructive",
      });
    };

    a.addEventListener("timeupdate", onTime);
    a.addEventListener("loadedmetadata", onMeta);
    a.addEventListener("ended", onEnded);
    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);
    a.addEventListener("error", onError);
    return () => {
      a.pause();
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("loadedmetadata", onMeta);
      a.removeEventListener("ended", onEnded);
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("error", onError);
      a.src = "";
    };
  }, [load, toast]);

  const playList = useCallback((tracks: Track[], startIndex = 0) => load(tracks, startIndex), [load]);

  const toggle = useCallback(() => {
    const a = audioRef.current;
    if (!a || !queueRef.current.length) return;
    if (a.paused) a.play().catch(() => {});
    else a.pause();
  }, []);

  const seek = useCallback((sec: number) => {
    const a = audioRef.current;
    if (a && isFinite(sec)) a.currentTime = sec;
  }, []);

  const jumpTo = useCallback(
    (i: number) => {
      if (i >= 0 && i < queueRef.current.length) load(queueRef.current, i);
    },
    [load]
  );

  const next = useCallback(() => jumpTo(indexRef.current + 1), [jumpTo]);
  const prev = useCallback(() => {
    const a = audioRef.current;
    if (a && a.currentTime > 3) {
      a.currentTime = 0;
      return;
    }
    jumpTo(indexRef.current - 1);
  }, [jumpTo]);

  const addToQueue = useCallback((t: Track) => {
    if (queueRef.current.some((x) => x.videoId === t.videoId)) return;
    const q = [...queueRef.current, t];
    queueRef.current = q;
    setQueue(q);
  }, []);

  const setVolume = useCallback((v: number) => {
    const a = audioRef.current;
    if (a) {
      a.volume = v;
      setVolumeState(v);
    }
  }, []);

  const current = queue[index] ?? null;

  return (
    <PlayerContext.Provider
      value={{ queue, index, current, isPlaying, time, duration, volume, playList, toggle, seek, next, prev, jumpTo, addToQueue, setVolume }}
    >
      {children}
    </PlayerContext.Provider>
  );
}
