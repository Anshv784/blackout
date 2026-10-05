import { lazy, Suspense, useEffect, useState } from "react";
import { audio } from "../game/audio";
import { INTRO_LENGTH } from "../game/colors";

const IntroScene = lazy(() => import("../scene/IntroScene").then((m) => ({ default: m.IntroScene })));

// the trailer's lines: short, slammed in, gone
const SLAMS: { at: number; to: number; text: string; sub?: string; left?: boolean }[] = [
  { at: 0.5, to: 3.2, text: "03:12", sub: "THE GRID FAILED" },
  { at: 3.9, to: 6.8, left: true, text: "EIGHT WOKE UP", sub: "IN THE YARD" },
  { at: 7.05, to: 7.95, left: true, text: "NYX", sub: "SNIPER" },
  { at: 8.05, to: 8.95, left: true, text: "UMBRA", sub: "BREACHER" },
  { at: 9.05, to: 9.95, left: true, text: "GLOOM", sub: "DEMOLITIONS" },
  { at: 10.05, to: 10.95, left: true, text: "VESPER", sub: "NIGHT VISION" },
  { at: 11.3, to: 13.3, text: "NO LIGHT.", sub: "NO RULES." },
  { at: 14.0, to: 16.3, text: "YOUR GUN", sub: "GIVES YOU AWAY" },
  { at: 21.3, to: 24.2, text: "THE WARDEN SEES ALL", sub: "AND TELLS NO ONE" },
  { at: 24.7, to: 27.9, text: "THE YARD SHRINKS", sub: "RUN" },
  { at: 28.3, to: 30.5, left: true, text: "ONE WALKS OUT" },
];
const TITLE_AT = 31.3;

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

  const slam = t >= TITLE_AT ? null : SLAMS.find((x) => t >= x.at && t < x.to) ?? null;
  const slamIdx = slam ? SLAMS.indexOf(slam) : -1;

  useEffect(() => {
    if (started && t >= INTRO_LENGTH + 3) finish();
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
      {slam && (
        <div className={`slam ${slam.left ? "left" : ""}`} key={slamIdx}>
          <b>{slam.text}</b>
          {slam.sub && <span>{slam.sub}</span>}
        </div>
      )}
      {t >= TITLE_AT && (
        <div className="intro-title">
          <h1>BLACKOUT</h1>
          <p>nobody sees you. not even the chain.</p>
          {t > TITLE_AT + 1.2 && (
            <button className="btn primary big" onClick={finish}>
              ENTER THE YARD
            </button>
          )}
        </div>
      )}
      <div className="intro-progress">
        <i style={{ width: `${Math.min(100, (t / INTRO_LENGTH) * 100)}%` }} />
      </div>
      <a className="intro-skip" onClick={finish}>
        skip ›
      </a>
    </div>
  );
}
