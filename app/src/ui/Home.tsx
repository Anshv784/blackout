import { useEffect, useRef, useState } from "react";
import { client } from "../game/identity";
import { PUBLIC_ROOMS, PRIVATE_POOL } from "../config";
import { STATUS_NAME, ST_LOBBY, type Room } from "../chain/layout";
import { go } from "../App";
import { useStore } from "../game/store";
import { audio } from "../game/audio";

const humans = (r: Room) => r.players.filter((p, i) => r.isBot[i] === 0 && p.toBase58() !== "11111111111111111111111111111111").length;

export function Home() {
  const [rooms, setRooms] = useState<Record<number, Room | null>>({});
  const [finding, setFinding] = useState(false);
  const hero = useRef<HTMLDivElement>(null);
  const toast = useStore((s) => s.toast);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const out: Record<number, Room | null> = {};
      await Promise.all(PUBLIC_ROOMS.map(async (id) => (out[id] = await client.fetchRoom(id).catch(() => null))));
      if (alive) setRooms(out);
    };
    load();
    const t = setInterval(load, 2500);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    const el = hero.current;
    if (!el) return;
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      el.style.setProperty("--mx", `${e.clientX - r.left}px`);
      el.style.setProperty("--my", `${e.clientY - r.top}px`);
    };
    window.addEventListener("pointermove", move);
    return () => window.removeEventListener("pointermove", move);
  }, []);

  const playNow = () => {
    audio.unlock();
    const open = PUBLIC_ROOMS.map((id) => [id, rooms[id]] as const).filter(([, r]) => r && r.status === ST_LOBBY && r.readyMask && humans(r) < 8);
    open.sort((a, b) => humans(b[1]!) - humans(a[1]!));
    go(`/r/${open[0]?.[0] ?? PUBLIC_ROOMS[0]}`);
  };

  const withFriends = async () => {
    audio.unlock();
    setFinding(true);
    try {
      const all = await Promise.all(PRIVATE_POOL.map(async (id) => [id, await client.fetchRoom(id).catch(() => null)] as const));
      const free = all.filter(([, r]) => r && r.status === ST_LOBBY && humans(r) === 0);
      const pick = free[Math.floor(Math.random() * free.length)] ?? all.find(([, r]) => r && r.status === ST_LOBBY);
      if (!pick) throw new Error("All private rooms are busy — try a public room");
      go(`/r/${pick[0]}`);
    } catch (e: any) {
      toast(e.message ?? String(e));
    } finally {
      setFinding(false);
    }
  };

  return (
    <div className="home">
      <div className="hero" ref={hero}>
        <div className="hero-dark" />
        <div className="hero-inner">
          <div className="kicker">
            <span className="dot" /> LIVE ON SOLANA DEVNET · MAGICBLOCK PRIVATE EPHEMERAL ROLLUP
          </div>
          <h1 className="logo">BLACKOUT</h1>
          <p className="tag-line">
            A real-time battle royale where <b>nobody can see you</b>.
            <br />
            Not the other players. Not the RPC. <b>Not even the chain.</b>
          </p>
          <div className="cta">
            <button className="btn primary big" onClick={playNow}>
              PLAY NOW
            </button>
            <button className="btn big" onClick={withFriends} disabled={finding}>
              {finding ? "FINDING ROOM…" : "PLAY WITH FRIENDS"}
            </button>
          </div>
          <div className="sub-cta">No wallet. No gas. No sign-up. Open the link and you're in.</div>
        </div>
      </div>

      <section className="pillars">
        <div className="pillar">
          <h3>Positions sealed in a TEE</h3>
          <p>Every player, bullet and loot roll lives in one account inside an Intel TDX enclave with <b>zero readers</b>. Each player only receives what their flashlight hits.</p>
        </div>
        <div className="pillar">
          <h3>20 ticks/second, no server</h3>
          <p>A MagicBlock crank steps the simulation inside the Private Ephemeral Rollup every 50 ms. Inputs are gasless transactions from a session key in your browser.</p>
        </div>
        <div className="pillar">
          <h3>VRF rolls everything</h3>
          <p>Spawns, loot and every zone shrink come from MagicBlock VRF — and stay sealed until each circle is announced.</p>
        </div>
        <div className="pillar">
          <h3>Then the lights come on</h3>
          <p>At the final kill the World is flipped public, the replay unlocks, and a Magic Action settles the pot and leaderboard on Solana.</p>
        </div>
      </section>

      <section className="rooms">
        <div className="rooms-head">
          <h2>Rooms</h2>
          <div className="links">
            <a onClick={() => go("/how")}>How it works</a>
            <a onClick={() => go("/board")}>Leaderboard</a>
          </div>
        </div>
        <div className="room-grid">
          {PUBLIC_ROOMS.map((id) => {
            const r = rooms[id];
            return (
              <button key={id} className="room-card" onClick={() => go(`/r/${id}`)}>
                <div className="rc-top">
                  <span className="rc-name">ROOM {id}</span>
                  <span className={`badge st-${r?.status ?? "x"}`}>{r ? STATUS_NAME[r.status] : "…"}</span>
                </div>
                <div className="rc-seats">
                  {Array.from({ length: 8 }, (_, i) => {
                    const taken = r && (r.isBot[i] === 1 || r.players[i].toBase58() !== "11111111111111111111111111111111");
                    return <i key={i} className={taken ? (r!.isBot[i] ? "bot" : "on") : ""} />;
                  })}
                </div>
                <div className="rc-meta">{r ? `${humans(r)} players · match #${r.matchNo}` : "connecting to TEE…"}</div>
              </button>
            );
          })}
        </div>
      </section>
      <footer className="foot">
        Built for MagicBlock Solana Blitz v9 · <a onClick={() => go("/how")}>architecture</a> · program{" "}
        <a href="https://explorer.solana.com/address/VWHcbCSH4kATcuPJgjZ6QC56W3NBQ53U6fxJNtGknh3?cluster=devnet" target="_blank" rel="noreferrer">
          VWHc…knh3
        </a>
      </footer>
    </div>
  );
}
