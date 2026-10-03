import { useEffect, useRef, useState } from "react";
import { audio } from "../game/audio";

const BEATS: { text: string; sub?: string; sfx?: "howl" | "creak" | "boom" | "whisper" | "heart" }[] = [
  { text: "03:12. The grid failed.", sub: "Every light in the city went out at once.", sfx: "boom" },
  { text: "The Yard.", sub: "Eight hundred shipping containers. One gate. No light.", sfx: "howl" },
  { text: "Eight of you woke up inside.", sub: "One flashlight each. One way out.", sfx: "creak" },
  { text: "Something keeps the score.", sub: "The Warden sees every step you take — and tells no one.", sfx: "whisper" },
  { text: "Your light shows you the way.", sub: "Your gun shows them where you are.", sfx: "heart" },
  { text: "When only one is left standing…", sub: "the lights come back on.", sfx: "boom" },
];

const HOLD = 4200;

export function Intro({ onDone }: { onDone: () => void }) {
  const [started, setStarted] = useState(false);
  const [i, setI] = useState(-1);
  const [typed, setTyped] = useState("");
  const timer = useRef<number | null>(null);

  const finish = () => {
    if (timer.current) clearTimeout(timer.current);
    audio.setHeartbeat(0);
    try {
      localStorage.setItem("bo-intro-seen", "1");
    } catch {
      /* ignore */
    }
    onDone();
  };

  const begin = () => {
    audio.unlock();
    audio.startAmbience(1);
    setStarted(true);
    setI(0);
  };

  useEffect(() => {
    if (i < 0) return;
    if (i >= BEATS.length) {
      audio.howl(0.5, 0.6, 0.3);
      timer.current = window.setTimeout(finish, 3800);
      return;
    }
    const b = BEATS[i];
    if (b.sfx === "howl") audio.howl(-0.6, 0.7);
    if (b.sfx === "creak") audio.creak(0.5);
    if (b.sfx === "boom") audio.boom();
    if (b.sfx === "whisper") {
      audio.whisper(-0.7);
      setTimeout(() => audio.whisper(0.7), 700);
    }
    if (b.sfx === "heart") audio.setHeartbeat(0.6);
    else audio.setHeartbeat(0);
    setTyped("");
    let k = 0;
    const type = window.setInterval(() => {
      k++;
      setTyped(b.text.slice(0, k));
      if (k >= b.text.length) clearInterval(type);
    }, 42);
    timer.current = window.setTimeout(() => setI(i + 1), HOLD + b.text.length * 20);
    return () => {
      clearInterval(type);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [i]);

  if (!started)
    return (
      <div className="intro" onClick={begin}>
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

  const beat = BEATS[i];
  return (
    <div className="intro">
      <div className="intro-grain" />
      {beat ? (
        <div className="intro-beat" key={i}>
          <h2>
            {typed}
            <span className="caret">▍</span>
          </h2>
          {beat.sub && <p>{beat.sub}</p>}
        </div>
      ) : (
        <div className="intro-title">
          <h1>BLACKOUT</h1>
          <p>nobody sees you. not even the chain.</p>
        </div>
      )}
      <div className="intro-progress">
        {BEATS.map((_, k) => (
          <i key={k} className={k <= i ? "on" : ""} />
        ))}
      </div>
      <a className="intro-skip" onClick={finish}>
        skip
      </a>
      {i === 3 && <div className="intro-note">The Warden is a MagicBlock Private Ephemeral Rollup — a TEE that runs the match and reveals nothing until the end.</div>}
    </div>
  );
}
