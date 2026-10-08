import { useEffect, useRef, useState } from "react";
import { audio } from "../game/audio";
import { usePrefs } from "../game/prefs";

/** The speaker button: opens a small panel with sound on/off and three volume sliders. */
export function SoundToggle({ className = "", up = false }: { className?: string; up?: boolean }) {
  const [muted, setMuted] = useState(audio.muted);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const p = usePrefs();
  useEffect(() => {
    const off = audio.onMute(setMuted);
    return () => {
      off();
    };
  }, []);
  // tap anywhere else to close
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", away, true);
    return () => window.removeEventListener("pointerdown", away, true);
  }, [open]);
  // a short sample so you hear the level you're setting
  const last = useRef(0);
  const preview = (kind: "sfx" | "music") => {
    const now = performance.now();
    if (now - last.current < 350) return;
    last.current = now;
    if (kind === "sfx") audio.shotAt(0, 3, 0);
    else audio.howl(0, 0.6);
  };
  const slider = (label: string, v: number, set: (v: number) => void, kind?: "sfx" | "music") => (
    <label className="vol-row">
      <span>{label}</span>
      <input
        type="range"
        min={0}
        max={1.5}
        step={0.05}
        value={v}
        onChange={(e) => {
          set(Number(e.target.value));
          if (kind) preview(kind);
        }}
      />
      <em>{Math.round(v * 100)}%</em>
    </label>
  );
  return (
    <div className={`sound-wrap ${up ? "up" : ""}`} ref={box} onPointerDown={(e) => e.stopPropagation()}>
      <button
        className={`sound-toggle ${className}`}
        title="Sound"
        aria-label="Sound settings"
        onClick={() => {
          audio.unlock();
          audio.startAmbience(1);
          setOpen((o) => !o);
        }}
      >
        {muted ? "🔇" : "🔊"}
      </button>
      {open && (
        <div className="vol-pop">
          <button className={`vol-mute ${muted ? "off" : ""}`} onClick={() => audio.setMuted(!muted)}>
            {muted ? "🔇 SOUND OFF" : "🔊 SOUND ON"} <i>M</i>
          </button>
          {slider("Master", p.volume, (v) => audio.setVolume(v), "sfx")}
          {slider("Guns & effects", p.sfxVol, (v) => audio.setSfxVolume(v), "sfx")}
          {slider("Music & ambience", p.musicVol, (v) => audio.setMusicVolume(v), "music")}
        </div>
      )}
    </div>
  );
}
