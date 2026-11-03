import { lazy, Suspense, useEffect, useState } from "react";
import { audio } from "../game/audio";
import { fullscreenOnTouch } from "./Fullscreen";
import { INTRO_LENGTH } from "../game/colors";
import { CLIPS } from "../game/trailer";

const loadScene = () => import("../scene/IntroScene");
const IntroScene = lazy(() => loadScene().then((m) => ({ default: m.IntroScene })));

// the story, told underneath the picture: narration (bottom), a few cards (centre), name tags
type Line = { at: number; to: number; text: string; kind: "say" | "card" | "name" | "tag"; sub?: string; n?: string };
const LINES: Line[] = [
  { at: 0.4, to: 2.4, kind: "card", text: "03:12", sub: "THE GRID FAILS" },
  { at: 2.7, to: 4.4, kind: "say", text: "Eight players. No lights. One way out." },
  { at: 4.6, to: 7.4, kind: "tag", n: "01", text: "STAY DARK", sub: "a light shows everyone where you are" },
  { at: 7.6, to: 9.9, kind: "tag", n: "02", text: "EVERY SHOT IS A FLARE", sub: "fire, and the whole map knows" },
  { at: 10.2, to: 11.9, kind: "say", text: "The Warden sees everything. It tells no one." },
  { at: 12.1, to: 14.4, kind: "card", text: "TWO MAPS", sub: "THE YARD · THE MEADOW" },
  { at: 14.6, to: 16.4, kind: "tag", n: "03", text: "HIDE IN THE GRASS", sub: "crouch and you vanish" },
  { at: 16.6, to: 18.7, kind: "tag", n: "04", text: "SILENT KILLS", sub: "the crossbow makes no sound, no flash" },
  { at: 18.9, to: 21.5, kind: "tag", n: "05", text: "AIM EVERY THROW", sub: "frags, smokes, flashbangs" },
  { at: 21.7, to: 23.3, kind: "tag", n: "06", text: "LOOT THE FALLEN", sub: "guns, armor, grenades" },
  { at: 23.5, to: 25.5, kind: "tag", n: "07", text: "THE CIRCLE CLOSES", sub: "the Warden picks where it ends" },
  { at: 26.0, to: 28.4, kind: "say", text: "He still trusts his light." },
  { at: 28.6, to: 29.9, kind: "card", text: "ONE BOLT", sub: "NO FLASH · NO SOUND" },
  { at: 30.4, to: 33.6, kind: "card", text: "ONE WALKS OUT" },
];
const TITLE_AT = INTRO_LENGTH;

export function Intro({ onDone }: { onDone: () => void }) {
  const [started, setStarted] = useState(false);
  const [ready, setReady] = useState(false);
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
  // a hard flash on every cut, like a trailer edit
  const cutFlash = t < TITLE_AT && CLIPS.some((c) => c.from > 0 && t >= c.from && t < c.from + 0.09);

  useEffect(() => {
    if (started && t >= INTRO_LENGTH + 8) finish();
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
          <small>the grid is failing…</small>
          <i>
            <span className="indeterminate" />
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
        ) : l.kind === "tag" ? (
          <div className="ad-tag" key={l.at}>
            <i>{l.n}</i>
            <div>
              <b>{l.text}</b>
              {l.sub && <span>{l.sub}</span>}
            </div>
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
      {cutFlash && <div className="cut-flash" />}
      {t >= TITLE_AT && (
        <div className="intro-title ad-end">
          <h1>BLACKOUT</h1>
          <p>The battle royale nobody can see. Not even the chain.</p>
          <div className="ad-facts">
            <span><b>8</b> players</span>
            <span><b>2</b> maps</span>
            <span><b>8</b> guns</span>
            <span><b>0</b> servers</span>
          </div>
          {t > TITLE_AT + 1.0 && (
            <button className="btn primary big" onClick={finish}>
              PLAY FREE NOW
            </button>
          )}
          <small className="ad-small">in your browser · sealed in a MagicBlock TEE · on Solana</small>
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
