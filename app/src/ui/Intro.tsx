import { Wordmark } from "./Brand";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { audio } from "../game/audio";
import { fullscreenOnTouch } from "./Fullscreen";
import { INTRO_LENGTH } from "../game/colors";
import { CLIPS } from "../game/trailer";

const loadScene = () => import("../scene/IntroScene");
const IntroScene = lazy(() => loadScene().then((m) => ({ default: m.IntroScene })));

// the story, told by DUSK: narration under the picture (spoken too), a card, and name tags
type Line = { at: number; to: number; text: string; kind: "say" | "card" | "name" | "tag"; sub?: string; n?: string; voice?: string };
const LINES: Line[] = [
  { at: 0.4, to: 3.2, kind: "card", text: "03:12", sub: "THE GRID FAILS" },
  { at: 6.6, to: 9.4, kind: "name", text: "DUSK", sub: "the one telling this" },
  { at: 13.4, to: 16.2, kind: "name", text: "NYX", sub: "the hunter" },
  { at: 22.2, to: 25.0, kind: "name", text: "WRAITH", sub: "the loud one" },
  { at: 33.4, to: 36.4, kind: "card", text: "THE MEADOW", sub: "NO WALLS · ONLY GRASS" },
  { at: 41.7, to: 44.3, kind: "name", text: "VEX", sub: "the quiet one" },
  { at: 3.6, to: 7.29, kind: "say", text: "Eight of us woke up in the Yard. No lights. One way out.", voice: "01" },
  { at: 9.6, to: 15.48, kind: "say", text: "My first mistake was the torch. A light lets you see... and lets everyone see you.", voice: "02" },
  { at: 15.4, to: 20.07, kind: "say", text: "Nyx had already learned that. Anything his light touched was his.", voice: "03" },
  { at: 19.9, to: 23.36, kind: "say", text: "So I stayed in the dark. And it passed me by.", voice: "04" },
  { at: 23.2, to: 24.94, kind: "say", text: "Wraith never learned.", voice: "05" },
  { at: 25.2, to: 27.18, kind: "say", text: "Every shot is a flare.", voice: "06" },
  { at: 27.4, to: 29.1, kind: "say", text: "Nyx didn't miss.", voice: "07" },
  { at: 29.8, to: 33.49, kind: "say", text: "Above us, the Warden sees everything. It tells no one.", voice: "08" },
  { at: 33.7, to: 39.72, kind: "say", text: "The circle didn't care about walls. It pushed the last of us out of the Yard... into the Meadow.", voice: "09" },
  { at: 40.2, to: 42.69, kind: "say", text: "Out here, the grass is the only cover.", voice: "10" },
  { at: 42.4, to: 44.33, kind: "say", text: "Gloom kept his torch on.", voice: "11" },
  { at: 44.3, to: 47.2, kind: "say", text: "Vex didn't need a light. Or a sound.", voice: "12" },
  { at: 46.95, to: 48.93, kind: "say", text: "So I answered with a grenade.", voice: "13" },
  { at: 49.0, to: 52.04, kind: "say", text: "And took his bow. Silent. No flash.", voice: "14" },
  { at: 51.9, to: 54.94, kind: "say", text: "The Warden drew the last circle around the bridge.", voice: "15" },
  { at: 55.3, to: 58.58, kind: "say", text: "Nyx was still out there... still trusting his light.", voice: "16" },
  { at: 59.4, to: 60.63, kind: "say", text: "One bolt.", voice: "17" },
  { at: 62.0, to: 66.76, kind: "say", text: "No flash. No sound. Eight walked in... one walks out.", voice: "18" },
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
    spoken.current.forEach((a) => a.pause());
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

  const showing = t >= TITLE_AT ? [] : LINES.filter((x) => t >= x.at && t < x.to);
  // one line of narration at a time: a new line replaces the one still fading out
  const lastSay = showing.filter((x) => x.kind === "say").reduce<Line | null>((m, x) => (!m || x.at > m.at ? x : m), null);
  const live = showing.filter((x) => x.kind !== "say" || x === lastSay);
  // the narration is spoken as well: each line starts when the picture reaches it
  const spoken = useRef(new Map<string, HTMLAudioElement>());
  useEffect(() => {
    if (!started || !ready) return;
    for (const l of LINES) {
      if (!l.voice || spoken.current.has(l.voice) || t < l.at || t > l.at + 0.5) continue;
      const a = new Audio(`/story/${l.voice}.mp3`);
      a.volume = 1;
      spoken.current.set(l.voice, a);
      if (!audio.muted) a.play().catch(() => {});
    }
  }, [t, started, ready]);
  useEffect(() => () => spoken.current.forEach((a) => a.pause()), []);
  // a quick dip to black around every cut (no white flash: easy on the eyes)
  // one slow fade through black, where the night moves from the Yard to the Meadow
  const dip = t >= TITLE_AT ? 0 : Math.max(0, ...CLIPS.filter((c) => c.dip).map((c) => 1 - Math.abs(t - c.from) / 0.7));

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
      {dip > 0 && <div className="cut-dip" style={{ opacity: Math.min(1, dip * 1.4) }} />}
      {t >= TITLE_AT && (
        <div className="intro-title ad-end">
          <h1>
            <Wordmark />
          </h1>
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
