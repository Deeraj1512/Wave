"use client";

/**
 * Spotify OAuth callback (WEB DEV runtime only).
 *
 * In the APK the login redirect is the custom scheme
 * com.deeraj.wave://callback, which Android hands to the app directly. On the
 * web dev server the dashboard's registered loopback redirect lands here with
 * ?code=…&state=… — this page hands the URL to userAuth's completer, then
 * sends the user back to where they started (search, with history intact).
 */

import { useEffect, useRef, useState } from "react";
import { spotifyCompleteLoginFromUrl } from "@/lib/spotify/userAuth";

export default function CallbackPage() {
  const [msg, setMsg] = useState("Finishing Spotify sign-in…");
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    spotifyCompleteLoginFromUrl(window.location.href).then((res) => {
      if (!res.ok) {
        setMsg(`Spotify sign-in failed: ${res.error ?? "unknown error"}`);
        return;
      }
      setMsg("Signed in — returning to Wave…");
      setTimeout(() => {
        // back to the search screen the user came from (or home on a fresh visit)
        if (window.history.length > 1) window.history.back();
        else window.location.assign("/");
      }, 600);
    });
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background text-foreground">
      <p className="px-6 text-center text-sm text-muted-foreground">{msg}</p>
    </main>
  );
}
