import { useEffect, useState } from "react";
import { audio } from "../game/audio";

export function SoundToggle({ className = "" }: { className?: string }) {
  const [muted, setMuted] = useState(audio.muted);
  useEffect(() => {
    const off = audio.onMute(setMuted);
    return () => {
      off();
    };
  }, []);
  return (
    <button
      className={`sound-toggle ${className}`}
      title={muted ? "Sound off (M)" : "Sound on (M)"}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={() => {
        audio.unlock();
        audio.startAmbience(1);
        audio.toggleMute();
      }}
    >
      {muted ? "🔇" : "🔊"}
    </button>
  );
}
