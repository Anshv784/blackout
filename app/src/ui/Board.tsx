import { TopBar } from "./TopBar";
import { useEffect, useState } from "react";
import { client } from "../game/identity";
import type { BoardEntry } from "../chain/layout";
import { boardPda } from "../chain/client";
import { explorerAddr } from "../config";
import { go } from "../App";

export function Board() {
  const [data, setData] = useState<{ matches: bigint; entries: BoardEntry[] } | null>(null);
  useEffect(() => {
    client.fetchBoard().then(setData).catch(() => setData(null));
  }, []);
  const rows = [...(data?.entries ?? [])].sort((a, b) => b.wins - a.wins || b.kills - a.kills || a.bestPlace - b.bestPlace);
  return (
    <div className="page">
      <TopBar active="board" />
      <h1>Leaderboard</h1>
      <p className="dim">
        Lives on Solana, not in the rollup. After every match the room is committed back to the base layer and a <b>Magic Action</b> runs <code>settle</code> on Solana,
        which updates this account.{" "}
        <a href={explorerAddr(boardPda().toBase58())} target="_blank" rel="noreferrer">
          view account ↗
        </a>
      </p>
      <div className="board">
        <div className="board-row head">
          <span>#</span>
          <span>player</span>
          <span>wins</span>
          <span>kills</span>
          <span>games</span>
          <span>best</span>
        </div>
        {rows.map((e, i) => (
          <div key={e.key.toBase58()} className={`board-row ${e.key.equals(client.publicKey) ? "me" : ""}`}>
            <span>{i + 1}</span>
            <span>
              <code>
                {e.key.toBase58().slice(0, 4)}…{e.key.toBase58().slice(-4)}
              </code>
            </span>
            <span>{e.wins}</span>
            <span>{e.kills}</span>
            <span>{e.games}</span>
            <span>{e.bestPlace === 99 ? "-" : `#${e.bestPlace}`}</span>
          </div>
        ))}
        {!rows.length && <div className="dim">No settled matches yet.</div>}
      </div>
      <p className="dim">{data ? `${data.matches.toString()} matches settled on-chain` : "loading…"}</p>
    </div>
  );
}
