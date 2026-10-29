"use client";

import { useEffect } from "react";

/**
 * Registers the Wave service worker (/sw.js) once the page has loaded.
 * Renders nothing. Safe to include in the root layout.
 */
export default function PwaRegister() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    const register = () => {
      navigator.serviceWorker
        .register("/sw.js")
        .catch((err) => console.warn("[pwa] service worker registration failed:", err));
    };

    if (document.readyState === "complete") {
      register();
      return;
    }
    window.addEventListener("load", register);
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
