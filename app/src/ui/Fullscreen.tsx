// Fullscreen: hides the browser's address bar and tabs. On phones it also turns the screen
// sideways and keeps it there (Android; iPhone Safari has no page fullscreen, so the button hides).
import { useEffect, useState } from "react";

const doc = () => document as Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => Promise<void> };
const root = () => document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };

export const canFullscreen = () => typeof document !== "undefined" && !!(root().requestFullscreen || root().webkitRequestFullscreen);
export const isFullscreen = () => !!(doc().fullscreenElement || doc().webkitFullscreenElement);

export async function enterFullscreen() {
  if (isFullscreen() || !canFullscreen()) return;
  try {
    const el = root();
    if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: "hide" });
    else await el.webkitRequestFullscreen?.();
    // phones: play sideways
    if (matchMedia("(pointer: coarse)").matches) await (screen.orientation as any)?.lock?.("landscape").catch(() => {});
  } catch {
    /* the browser said no (needs a tap first, or not allowed) */
  }
}

export async function exitFullscreen() {
  try {
    if (document.exitFullscreen) await document.exitFullscreen();
    else await doc().webkitExitFullscreen?.();
  } catch {
    /* ignore */
  }
}

export function useFullscreen() {
  const [on, setOn] = useState(isFullscreen);
  useEffect(() => {
    const f = () => setOn(isFullscreen());
    document.addEventListener("fullscreenchange", f);
    document.addEventListener("webkitfullscreenchange", f);
    return () => {
      document.removeEventListener("fullscreenchange", f);
      document.removeEventListener("webkitfullscreenchange", f);
    };
  }, []);
  return on;
}

/** Phones go fullscreen on their own at the first tap that starts something (the browser requires a tap). */
export function fullscreenOnTouch() {
  if (matchMedia("(pointer: coarse)").matches) void enterFullscreen();
}

export function FullscreenButton({ className = "" }: { className?: string }) {
  const on = useFullscreen();
  if (!canFullscreen()) return null;
  return (
    <button className={`fs-btn ${className}`} onClick={() => (on ? exitFullscreen() : enterFullscreen())} title={on ? "Exit fullscreen" : "Fullscreen"} aria-label={on ? "Exit fullscreen" : "Fullscreen"}>
      <svg viewBox="0 0 24 24" aria-hidden>
        {on ? <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /> : <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />}
      </svg>
    </button>
  );
}
