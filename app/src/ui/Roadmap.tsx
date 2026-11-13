// The road: shipped, mainnet, Solana Seeker, Google Play, ecosystem expansion. Future steps carry no
// invented dates; the mainnet step reads the network the site runs on.
import { useEffect, useRef, useState } from "react";
import { TopBar } from "./TopBar";
import { go } from "../App";
import { NETWORK } from "../config";

type Status = "done" | "now" | "next";
type Milestone = { date?: string; title: string; text: string; tags?: string[]; status: Status };

const MAINNET = NETWORK === "mainnet";

const MILESTONES: Milestone[] = [
  {
    date: "Oct 3, 2026",
    title: "BLACKOUT ships",
    text: "BLACKOUT goes live on Solana devnet: a real-time battle royale where every position is sealed inside MagicBlock's private rollup.",
    status: "done",
  },
  {
    date: MAINNET ? "Live" : "Now",
    title: "Solana mainnet",
    text: "Free rooms for everyone, staked tables for real SOL and the daily prize.",
    status: MAINNET ? "done" : "now",
  },
  {
    title: "Solana Seeker",
    text: "On the Solana dApp Store, with the phone's wallet built in.",
    status: MAINNET ? "now" : "next",
  },
  {
    title: "Google Play",
    text: "BLACKOUT on every Android phone.",
    status: "next",
  },
  {
    title: "Ecosystem expansion",
    text: "Tournaments, partners and more of Solana playing in the dark.",
    status: "next",
  },
];

const STATUS_LABEL: Record<Status, string> = { done: "Shipped", now: "In progress", next: "Next" };


/** Fades a card in the first time it scrolls into view. */
function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || shown) return;
    if (!("IntersectionObserver" in window)) return setShown(true);
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setShown(true), { threshold: 0.2 });
    io.observe(el);
    return () => io.disconnect();
  }, [shown]);
  return [ref, shown] as const;
}

function Step({ m, i }: { m: Milestone; i: number }) {
  const [ref, shown] = useReveal<HTMLLIElement>();
  return (
    <li ref={ref} className={`rm-step ${m.status} ${shown ? "in" : ""}`} style={{ transitionDelay: `${(i % 3) * 60}ms` }}>
      <span className="rm-node" aria-hidden>
        {m.status === "done" ? (
          <svg viewBox="0 0 24 24">
            <path d="M5 12.5l4.2 4.2L19 7" />
          </svg>
        ) : (
          <i />
        )}
      </span>
      <div className="rm-card">
        <div className="rm-meta">
          <span className={`rm-badge ${m.status}`}>{STATUS_LABEL[m.status]}</span>
          {m.date && <span className="rm-date">{m.date}</span>}
        </div>
        <h3>{m.title}</h3>
        <p>{m.text}</p>
        {m.tags && (
          <div className="rm-tags">
            {m.tags.map((t) => (
              <span key={t}>{t}</span>
            ))}
          </div>
        )}
      </div>
    </li>
  );
}

export function Roadmap() {
  // the gold rail runs down to the step that's in progress (or the last shipped one)
  const lastDone = MILESTONES.reduce((a, m, i) => (m.status === "done" ? i : a), 0);
  const nowIdx = MILESTONES.findIndex((m) => m.status === "now");
  const railTo = ((nowIdx >= 0 ? nowIdx : lastDone) + 0.5) / MILESTONES.length;

  return (
    <div className="page roadmap">
      <TopBar active="roadmap" />
      <header className="rm-hero">
        <div className="kicker">
          <span className="dot" /> THE ROAD SO FAR · {NETWORK.toUpperCase()}
        </div>
        <h1>
          From one dark yard to <em>every phone</em>.
        </h1>
        <p className="lead">Where BLACKOUT is, and where it goes next.</p>

      </header>

      <ol className="rm-line" style={{ ["--rail" as string]: `${railTo * 100}%` }}>
        {MILESTONES.map((m, i) => (
          <Step key={m.title} m={m} i={i} />
        ))}
      </ol>

      <div className="rm-cta">
        <button className="btn primary huge" onClick={() => go("/")}>
          PLAY NOW
        </button>
        <span>Free to play · stake when you're ready</span>
      </div>
    </div>
  );
}
