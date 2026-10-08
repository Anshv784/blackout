import { lazy, Suspense, useEffect, useState } from "react";
import { useProgress } from "@react-three/drei";
import { audio } from "../game/audio";
import { fullscreenOnTouch } from "./Fullscreen";
import { INTRO_LENGTH } from "../game/colors";

const loadScene = () => import("../scene/IntroScene");
const IntroScene = lazy(() => loadScene().then((m) => ({ default: m.IntroScene })));

// the story, told underneath the picture: narration (bottom), a few cards (centre), name tags
type Line = { at: number; to: number; text: string; kind: "say" | "card" | "name"; sub?: string };
const LINES: Line[] = [
  { at: 0.6, to: 2.9, kind: "card", text: "03:12", sub: "THE GRID FAILS" },
  { at: 3.4, to: 5.8, kind: "say", text: "Every light in the district goes out at once." },
  { at: 6.6, to: 9.4, kind: "say", text: "Eight strangers wake up inside the Yard." },
  { at: 7.2, to: 12.6, kind: "name", text: "DUSK", sub: "woke up first" },
  { at: 9.8, to: 12.8, kind: "say", text: "No map. No allies. One way out." },
  { at: 13.6, to: 17.0, kind: "say", text: "A torch shows you the way…" },
  { at: 14.4, to: 19.5, kind: "name", text: "NYX", sub: "sniper · hunting" },
  { at: 17.3, to: 21.6, kind: "say", text: "…and shows everyone else exactly where you are." },
  { at: 22.4, to: 25.0, kind: "say", text: "WRAITH heard something in the dark." },
  { at: 22.6, to: 25.0, kind: "name", text: "WRAITH", sub: "kept his light on" },
  { at: 26.9, to: 29.0, kind: "card", text: "EVERY SHOT", sub: "IS A FLARE" },
  { at: 29.8, to: 32.0, kind: "say", text: "Above the Yard, the Warden sees every move…" },
  { at: 32.0, to: 33.9, kind: "card", text: "IT TELLS NO ONE" },
  { at: 34.4, to: 37.0, kind: "say", text: "Then the Yard starts to close." },
  { at: 40.4, to: 44.8, kind: "say", text: "Stay dark. Stay low. Let the light come to you." },
  { at: 47.4, to: 49.8, kind: "card", text: "ONE WALKS OUT" },
];
const TITLE_AT = INTRO_LENGTH;

export function Intro({ onDone }: { onDone: () => void }) {
  const [started, setStarted] = useState(false);
  const [ready, setReady] = useState(false);
  const { progress } = useProgress();
  // start downloading the 3D story (code + soldier model) while the ENTER screen is up
  useEffect(() => {
    void loadScene();
  }, []);
  const [t, setT] = useState(0);

  const finish = () => {
    audio.setHeartbeat(0);
    // the story's score gives way to the Yard's own dread
    audio.stopAmbience();
    setTimeout(() => audio.startAmbience(1), 400);
    try {
      localStorage.setItem("bo-intro-seen", "1");
    } catch {
      /* ignore */
    }
    onDone();
  };

  const live = t >= TITLE_AT ? [] : LINES.filter((x) => t >= x.at && t < x.to);

  useEffect(() => {
    if (started && t >= INTRO_LENGTH + 3) finish();
  }, [t, started]);

  if (!started)
    return (
      <div
        className="intro"
        onClick={() => {
          audio.unlock();
          audio.stopAmbience(); // the page's first tap may already have started the night's bed
          audio.startAmbience(1, true);
          fullscreenOnTouch();
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
        <IntroScene onTime={setT} onReady={() => setReady(true)} />
      </Suspense>
      {!ready && (
        <div className="intro-loading">
          <div className="intro-eye small" />
          <b>03:12</b>
          <small>the grid is failing… {Math.round(progress)}%</small>
          <i>
            <span style={{ width: `${Math.max(4, progress)}%` }} />
          </i>
        </div>
      )}
      <div className="letterbox top" />
      <div className="letterbox bottom" />
      {live.map((l) =>
        l.kind === "card" ? (
          <div className="slam" key={l.at}>
            <b>{l.text}</b>
            {l.sub && <span>{l.sub}</span>}
          </div>
        ) : l.kind === "name" ? (
          <div className="story-name" key={l.at}>
            <b>{l.text}</b>
            {l.sub && <span>{l.sub}</span>}
          </div>
        ) : (
          <p className="story-say" key={l.at}>
            {l.text}
          </p>
        ),
      )}
      {t >= TITLE_AT && (
        <div className="intro-title">
          <h1>BLACKOUT</h1>
          <p>stay dark. nobody sees you, not even the chain.</p>
          {t > TITLE_AT + 1.2 && (
            <button className="btn primary big" onClick={finish}>
              ENTER THE YARD
            </button>
          )}
        </div>
      )}
      {/* the story is shot wide: on a phone held upright, ask for sideways */}
      <div className="intro-rotate">
        <svg viewBox="0 0 24 24"><rect x="7" y="3" width="10" height="18" rx="2" /><path d="M20 9a8 8 0 0 1 0 6M4 9a8 8 0 0 0 0 6" /></svg>
        <b>TURN YOUR PHONE</b>
        <small>the story plays sideways</small>
      </div>
      <div className="intro-progress">
        <i style={{ width: `${Math.min(100, (t / INTRO_LENGTH) * 100)}%` }} />
      </div>
      <a className="intro-skip" onClick={finish}>
        skip ›
      </a>
    </div>
  );
}
