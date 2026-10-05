import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { audio } from "../game/audio";
import { INTRO_LENGTH, CAST, SEAT_COLORS } from "../game/colors";

const IntroScene = lazy(() => import("../scene/IntroScene").then((m) => ({ default: m.IntroScene })));

const BEATS: { at: number; text: string; sub: string }[] = [
  { at: 0.6, text: "03:12. The grid failed.", sub: "Every light in the city went out at once." },
  { at: 3.2, text: "The Yard.", sub: "Eight hundred containers. One gate. No light." },
  { at: 6.1, text: "Eight of them woke up inside.", sub: "" },
  { at: 16.6, text: "Something keeps the score.", sub: "The Warden sees every step you take — and tells no one." },
  { at: 21.8, text: "Your light shows you the way.", sub: "Your gun shows them where you are." },
  { at: 28.4, text: "When only one is left standing…", sub: "the lights come back on. Tonight, you're the ninth." },
];
const TITLE_AT = 33.6;

export function Intro({ onDone }: { onDone: () => void }) {
  const [started, setStarted] = useState(false);
  const [t, setT] = useState(0);

  const finish = () => {
    audio.setHeartbeat(0);
    try {
      localStorage.setItem("bo-intro-seen", "1");
    } catch {
      /* ignore */
    }
    onDone();
  };

  const beatIdx = useMemo(() => {
    let k = -1;
    BEATS.forEach((b, i) => {
      if (t >= b.at) k = i;
    });
    return t >= TITLE_AT ? -2 : k;
  }, [t]);
  const beat = beatIdx >= 0 ? BEATS[beatIdx] : null;
  // the line-up: one card per operative while their light is on
  const castIdx = t >= 16.3 ? -1 : CAST.reduce((k, c, i) => (t >= c.at ? i : k), -1);
  const chars = beat ? Math.floor((t - beat.at) / 0.045) : 0;

  useEffect(() => {
    if (started && t >= INTRO_LENGTH + 0.5) finish();
  }, [t, started]);

  if (!started)
    return (
      <div
        className="intro"
        onClick={() => {
          audio.unlock();
          audio.startAmbience(1);
          setStarted(true);
        }}
      >
        <div className="intro-start">
          <div className="intro-eye" />
          <p>🎧 headphones recommended</p>
          <button className="btn primary big">ENTER</button>
          <a
            className="intro-skip"
            onClick={(e) => {
              e.stopPropagation();
              audio.unlock();
              audio.startAmbience(1);
              finish();
            }}
          >
            skip story
          </a>
        </div>
      </div>
    );

  return (
    <div className="intro cinematic">
      <Suspense fallback={null}>
        <IntroScene onTime={setT} />
      </Suspense>
      <div className="letterbox top" />
      <div className="letterbox bottom" />
      {castIdx >= 0 && (
        <div className="cast-card" key={castIdx} style={{ ["--c" as any]: SEAT_COLORS[castIdx] }}>
          <small>
            {String(castIdx + 1).padStart(2, "0")} / 08 · {CAST[castIdx].role}
          </small>
          <b>{CAST[castIdx].name}</b>
          <p>{CAST[castIdx].line}</p>
        </div>
      )}
      {beat && castIdx < 0 && (
        <div className="intro-beat" key={beatIdx}>
          <h2>
            {beat.text.slice(0, chars)}
            {chars < beat.text.length && <span className="caret">▍</span>}
          </h2>
          {chars > beat.text.length + 8 && <p>{beat.sub}</p>}
        </div>
      )}
      {beatIdx === -2 && (
        <div className="intro-title">
          <h1>BLACKOUT</h1>
          <p>nobody sees you. not even the chain.</p>
          {t > TITLE_AT + 2 && (
            <button className="btn primary big" onClick={finish}>
              ENTER THE YARD
            </button>
          )}
        </div>
      )}
      {beatIdx === 3 && <div className="intro-note">The Warden is a MagicBlock Private Ephemeral Rollup — a TEE that runs every match and reveals nothing until the end.</div>}
      <div className="intro-progress">
        <i style={{ width: `${Math.min(100, (t / INTRO_LENGTH) * 100)}%` }} />
      </div>
      <a className="intro-skip" onClick={finish}>
        skip ›
      </a>
    </div>
  );
}
