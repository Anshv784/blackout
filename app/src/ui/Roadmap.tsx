// The road so far: what's shipped (with real dates), what's happening now, and what's next. Only
// milestones that matter to players; future ones carry no invented dates. The mainnet step reads
// the network the site runs on, and the numbers at the top are read live from the chain.
import { useEffect, useRef, useState } from "react";
import { TopBar } from "./TopBar";
import { go } from "../App";
import { NETWORK } from "../config";
import { client } from "../game/identity";

type Status = "done" | "now" | "next";
type Milestone = { date?: string; title: string; text: string; tags?: string[]; status: Status };

const MAINNET = NETWORK === "mainnet";

const MILESTONES: Milestone[] = [
  {
    date: "Oct 3, 2026",
    title: "The first night goes dark",
    text: "A real-time battle royale running on Solana: 20 ticks a second, every position sealed inside a MagicBlock Private Ephemeral Rollup. Nobody sees you, not even the chain.",
    tags: ["Devnet", "MagicBlock PER", "VRF"],
    status: "done",
  },
  {
    date: "Oct 12, 2026",
    title: "Entered Colosseum's Crypto World's Fair",
    text: "Submitted to Colosseum's cross-chain startup competition.",
    tags: ["Colosseum"],
    status: "done",
  },
  {
    date: "Oct 15, 2026",
    title: "2nd place at MagicBlock Solana Blitz v9",
    text: "Judged against the week's best builds on Ephemeral Rollups.",
    tags: ["Award"],
    status: "done",
  },
  {
    date: "Nov 2026",
    title: "Two maps, eight guns, your own operator",
    text: "The Yard and the Meadow, gadgets and loot, six operators with outfits, gun finishes and live skins, emotes everyone at the table can see.",
    tags: ["Content"],
    status: "done",
  },
  {
    date: "Nov 12, 2026",
    title: "Staked nights",
    text: "0.01 and 0.05 SOL tables with no host: everyone puts in the same stake, the last one standing takes 90% of the pot, paid to their wallet on Solana the moment the night ends.",
    tags: ["Real SOL", "Magic Action payouts"],
    status: "done",
  },
  {
    date: "Nov 13, 2026",
    title: "The daily prize",
    text: "3.5% of every 0.05 SOL pot builds the day's prize. Play three nights, beat the most different players, and it's yours, kept until you claim it.",
    tags: ["Daily challenge"],
    status: "done",
  },
  {
    date: "Nov 13, 2026",
    title: "Pre-mainnet audit",
    text: "Every instruction re-read, every money rule and attack tested against the live program: stakes, payouts, the fee, the prize, refunds that must never happen.",
    tags: ["58 / 58 money checks", "69 program tests"],
    status: "done",
  },
  {
    date: MAINNET ? "Live" : "Now",
    title: "Live on Solana mainnet",
    text: "Free rooms for everyone, staked tables for real SOL, the daily prize, all on mainnet.",
    tags: ["Mainnet"],
    status: MAINNET ? "done" : "now",
  },
  {
    title: "Locked down by a multisig",
    text: "The game's upgrade key and fee wallet move to a Squads multisig: no single key can change the game or touch the house share.",
    tags: ["Security"],
    status: MAINNET ? "now" : "next",
  },
  {
    title: "On every phone",
    text: "BLACKOUT as an app on the Solana dApp Store for Seeker, on Google Play and on the App Store, with your phone's wallet built in.",
    tags: ["Seeker", "Google Play", "App Store"],
    status: "next",
  },
  {
    title: "Tournaments",
    text: "Bigger prizes and bracket nights, funded by BLACKOUT's share of the house fee.",
    tags: ["Prizes"],
    status: "next",
  },
];

const STATUS_LABEL: Record<Status, string> = { done: "Shipped", now: "In progress", next: "Next" };

function useLiveStats() {
  const [s, setS] = useState<{ nights: number; players: number; sol: number } | null>(null);
  useEffect(() => {
    client
      .fetchBoard()
      .then((b) => b && setS({ nights: Number(b.matches), players: b.entries.length, sol: b.entries.reduce((a, e) => a + Number(e.earned), 0) / 1e9 }))
      .catch(() => {});
  }, []);
  return s;
}

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
  const stats = useLiveStats();
  const done = MILESTONES.filter((m) => m.status === "done").length;
  const pct = Math.round((done / MILESTONES.length) * 100);
  const [fill, setFill] = useState(0);
  useEffect(() => {
    const t = window.setTimeout(() => setFill(pct), 150);
    return () => clearTimeout(t);
  }, [pct]);
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
        <p className="lead">What's shipped, what's happening now, and what comes next. Only the milestones that change how you play.</p>

        <div className="rm-progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="rm-progress-top">
            <span>
              <b>{done}</b> of {MILESTONES.length} milestones shipped
            </span>
            <b className="rm-pct">{pct}%</b>
          </div>
          <div className="rm-bar">
            <i style={{ width: `${fill}%` }} />
          </div>
        </div>

        <div className="rm-stats">
          <div>
            <b>{stats ? stats.nights.toLocaleString() : "—"}</b>
            <span>staked nights played</span>
          </div>
          <div>
            <b>{stats ? stats.players.toLocaleString() : "—"}</b>
            <span>stakers on the board</span>
          </div>
          <div>
            <b>{stats ? stats.sol.toFixed(2) : "—"}</b>
            <span>SOL won by players</span>
          </div>
        </div>
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
