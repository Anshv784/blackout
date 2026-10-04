import { lazy, Suspense, useEffect, useState } from "react";
import { TopBar } from "./TopBar";
import { client } from "../game/identity";
import { useStore } from "../game/store";
import type { BoardEntry } from "../chain/layout";
import { boardPda } from "../chain/client";
import { explorerAddr, STAKED_ROOMS } from "../config";
import { go } from "../App";
import { requireRealWallet } from "../game/wallet";

const Backdrop = lazy(() => import("../scene/Backdrop").then((m) => ({ default: m.Backdrop })));

// The board stores wallets/keys only — give every key a stable, readable callsign.
const ADJ = ["SILENT", "HOLLOW", "NIGHT", "STATIC", "LOW", "COLD", "PALE", "DARK", "QUIET", "BLIND", "ASH", "IRON", "GREY", "LAST", "GHOST", "DEEP"];
const NOUN = ["FOX", "MOTH", "OWL", "LYNX", "CROW", "VIPER", "WOLF", "HARE", "RAVEN", "BAT", "HOUND", "ADDER", "SHRIKE", "JACKAL", "MANTIS", "SHADE"];
export function aliasFor(key: string) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619) >>> 0;
  return `${ADJ[h % ADJ.length]} ${NOUN[(h >>> 8) % NOUN.length]}`;
}
const short = (k: string) => `${k.slice(0, 4)}…${k.slice(-4)}`;
const MEDAL = ["#ffd166", "#cfd8e6", "#d98c5f"];

export function Board() {
  const [data, setData] = useState<{ matches: bigint; entries: BoardEntry[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const wallet = useStore((s) => s.wallet);
  const mine = new Set([client.publicKey.toBase58(), ...(wallet ? [wallet] : [])]);
  useEffect(() => {
    client
      .fetchBoard()
      .then(setData)
      .catch(() => setFailed(true));
  }, []);
  const rows = [...(data?.entries ?? [])].sort((a, b) => b.wins - a.wins || Number(b.earned - a.earned) || b.kills - a.kills || b.games - a.games);
  const podium = rows.slice(0, 3);
  const totalWon = rows.reduce((n, e) => n + Number(e.earned), 0) / 1e9;
  const myIdx = rows.findIndex((e) => mine.has(e.key.toBase58()));

  return (
    <div className="gate board-page">
      <Suspense fallback={<div className="backdrop" />}>
        <Backdrop focus="lobby" />
      </Suspense>
      <div className="gate-shade dense" />
      <TopBar active="board" />
      <main className="board-main">
        <div className="board-head">
          <div className="kicker">
            <span className="dot" /> STAKED NIGHTS ONLY · HUMANS ONLY · SETTLED ON SOLANA BY A MAGIC ACTION
          </div>
          <h1>Top Staked Winners</h1>
          <div className="board-stats">
            <div>
              <b>{data ? data.matches.toString() : "—"}</b>
              <span>staked nights</span>
            </div>
            <div>
              <b>{rows.length || "—"}</b>
              <span>stakers ranked</span>
            </div>
            <div>
              <b>{totalWon ? totalWon.toFixed(2) : "—"}</b>
              <span>SOL won</span>
            </div>
          </div>
        </div>

        {!data && !failed && <div className="board-loading"><div className="warden-loader" /> reading the board from Solana…</div>}
        {failed && <div className="board-loading">Couldn't reach Solana devnet — try again in a moment.</div>}

        {podium.length > 0 && (
          <div className="podium">
            {[1, 0, 2].map((i) => {
              const e = podium[i];
              if (!e) return <div key={i} className="pod empty" />;
              const k = e.key.toBase58();
              return (
                <div key={k} className={`pod p${i + 1} ${mine.has(k) ? "me" : ""}`} style={{ ["--m" as any]: MEDAL[i] }}>
                  <div className="pod-rank">{["I", "II", "III"][i]}</div>
                  <div className="pod-orb" />
                  <div className="pod-name">{e.name || aliasFor(k)}</div>
                  <code>{short(k)}</code>
                  <div className="pod-stats">
                    <span>
                      <b>{e.wins}</b> wins
                    </span>
                    <span>
                      <b>{(Number(e.earned) / 1e9).toFixed(2)}</b> SOL
                    </span>
                  </div>
                  {mine.has(k) && <div className="pod-you">YOU</div>}
                </div>
              );
            })}
          </div>
        )}

        {rows.length > 0 && (
          <div className="board-table">
            <div className="bt-row head">
              <span>#</span>
              <span>survivor</span>
              <span>wins</span>
              <span>SOL won</span>
              <span>kills</span>
              <span>nights</span>
              <span>win rate</span>
            </div>
            {rows.map((e, i) => {
              const k = e.key.toBase58();
              const rate = e.games ? Math.round((e.wins / e.games) * 100) : 0;
              return (
                <div key={k} className={`bt-row ${mine.has(k) ? "me" : ""}`}>
                  <span className="bt-rank" style={i < 3 ? { color: MEDAL[i] } : undefined}>
                    {i + 1}
                  </span>
                  <span className="bt-name">
                    <b>{e.name || aliasFor(k)}</b>
                    <code>{short(k)}</code>
                    {mine.has(k) && <em>YOU</em>}
                  </span>
                  <span>{e.wins}</span>
                  <span className="bt-sol">{(Number(e.earned) / 1e9).toFixed(2)}</span>
                  <span>{e.kills}</span>
                  <span>{e.games}</span>
                  <span className="bt-rate">
                    <i style={{ width: `${rate}%` }} />
                    <small>{rate}%</small>
                  </span>
                </div>
              );
            })}
          </div>
        )}

        <div className="board-foot">
          {myIdx < 0 ? (
            <div className="board-cta">
              <span>{rows.length ? "You're not on the board yet. Win a staked night to get on it." : "No staked night has been won yet. The first winner takes #1."}</span>
              <button className="btn primary" onClick={() => requireRealWallet(() => go(`/r/${STAKED_ROOMS[0]}`))}>
                PLAY A STAKED NIGHT
              </button>
            </div>
          ) : (
            <div className="board-cta">
              <span>
                You're <b>#{myIdx + 1}</b> of {rows.length}.
              </span>
              <button className="btn primary" onClick={() => go("/")}>
                CLIMB HIGHER
              </button>
            </div>
          )}
          <a href={explorerAddr(boardPda().toBase58())} target="_blank" rel="noreferrer">
            verify the board on Solana Explorer ↗
          </a>
        </div>
      </main>
    </div>
  );
}
