import { useState } from "react";
import { TopBar } from "./TopBar";
import { go } from "../App";
import { client } from "../game/identity";
import { ROOM_POOL, explorerAddr } from "../config";
import { PROGRAM_ID, TEE_VALIDATOR, boardPda, roomPda, viewPda, worldPda } from "../chain/client";
import { ST_LIVE, ST_REVEALED, STATUS_NAME } from "../chain/layout";

const Box = ({ x, y, w, h, title, sub, tone }: { x: number; y: number; w: number; h: number; title: string; sub: string; tone: string }) => (
  <g>
    <rect x={x} y={y} width={w} height={h} rx={10} fill="var(--panel)" stroke={tone} strokeWidth={1.5} />
    <text x={x + 14} y={y + 26} fill="var(--fg)" fontSize={15} fontWeight={700}>
      {title}
    </text>
    {sub.split("\n").map((l, i) => (
      <text key={i} x={x + 14} y={y + 48 + i * 18} fill="var(--dim)" fontSize={12.5}>
        {l}
      </text>
    ))}
  </g>
);

const short = (k: string) => `${k.slice(0, 4)}…${k.slice(-4)}`;

// ---------------------------------------------------------------- live proof

type Line = { label: string; addr: string; ok: boolean | null; note: string };

/** Asks the TEE, with your own signed token, for three accounts of a real room. */
function PeekConsole() {
  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);
  const [room, setRoom] = useState<string>("");

  const run = async () => {
    setBusy(true);
    setLines([]);
    try {
      const rooms = await Promise.all(ROOM_POOL.map(async (id) => [id, await client.fetchRoom(id).catch(() => null)] as const));
      // prefer a match that is live right now; any un-revealed room is sealed the same way
      const pick = rooms.find(([, r]) => r && r.status === ST_LIVE) ?? rooms.find(([, r]) => r && r.status !== ST_REVEALED) ?? rooms[0];
      const [id, r] = pick;
      setRoom(`room ${id} · ${r ? STATUS_NAME[r.status] : "?"}`);
      const add = (l: Line) => setLines((x) => [...x, l]);
      const wait = () => new Promise((res) => setTimeout(res, 450));

      add({ label: "Room", addr: roomPda(id).toBase58(), ok: !!r, note: r ? `readable: ${r.aliveCount} alive, zone r=${(r.zone.r / 256).toFixed(1)} tiles, names, kill feed` : "not found" });
      await wait();
      const world = await client.fetchWorld(id).catch(() => null);
      add({
        label: "World",
        addr: worldPda(id).toBase58(),
        ok: !world,
        note: world ? "readable (this match is over: the lights are on)" : "DENIED: every position, bullet, loot roll and the VRF seed live here, with zero readers",
      });
      await wait();
      const seat = r ? Math.max(0, r.players.findIndex((p, i) => r.isBot[i] === 0 && !p.equals(client.publicKey) && p.toBase58() !== "11111111111111111111111111111111")) : 0;
      const view = await client.fetchView(id, seat).catch(() => null);
      add({
        label: `View · seat ${seat}`,
        addr: viewPda(id, seat).toBase58(),
        ok: !view,
        note: view ? "readable (it's your own seat, or the match is revealed)" : "DENIED: only that seat's session key may read what their flashlight sees",
      });
    } catch (e: any) {
      setLines((x) => [...x, { label: "error", addr: "", ok: null, note: String(e?.message ?? e).slice(0, 120) }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="peek">
      <div className="peek-head">
        <div>
          <div className="kicker">
            <span className="dot" /> LIVE · NOT A MOCKUP
          </div>
          <h2>Try to cheat</h2>
          <p>
            This button asks MagicBlock's TEE validator for three accounts of a real room on devnet, using a token signed by your browser's key. A wallhack would need
            the second one.
          </p>
        </div>
        <button className="btn primary" onClick={run} disabled={busy}>
          {busy ? "ASKING THE TEE…" : lines.length ? "RUN AGAIN" : "PEEK AT A MATCH"}
        </button>
      </div>
      <div className="peek-term">
        <div className="peek-bar">
          <i />
          <i />
          <i />
          <span>getAccountInfo → devnet-tee.magicblock.app {room && `· ${room}`}</span>
        </div>
        {!lines.length && !busy && <div className="peek-idle">$ waiting for you to try…</div>}
        {lines.map((l, i) => (
          <div key={i} className={`peek-line ${l.label === "Room" ? "pub" : l.ok ? "deny" : "open"}`}>
            <b>{l.label === "Room" ? (l.ok ? "✓" : "?") : l.ok ? "🔒" : "✓"}</b>
            <span className="pl-name">{l.label}</span>
            {l.addr && (
              <a href={explorerAddr(l.addr)} target="_blank" rel="noreferrer">
                {short(l.addr)}
              </a>
            )}
            <em>{l.note}</em>
          </div>
        ))}
        {busy && <div className="peek-idle blink">▍</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- content

const BLOCKS: { icon: string; name: string; tone: string; what: string; code: string; without: string }[] = [
  {
    icon: "🛡",
    name: "Private Ephemeral Rollup",
    tone: "#a64dff",
    what: "The whole match (physics, bullets, bots, vision) runs on MagicBlock's TEE validator, a Solana runtime inside an Intel TDX enclave.",
    code: "delegate_room → MTEW…xzo",
    without: "Every position is public state. Fog of war is impossible on-chain.",
  },
  {
    icon: "🔑",
    name: "Ephemeral permissions",
    tone: "#ffd166",
    what: "Each account has its own reader list. The World account has zero readers, each View has exactly one (its seat's key), and Room has everyone.",
    code: "join · kick · finish → UpdateEphemeralPermissionCpi",
    without: "A private rollup would still leak: anyone with RPC access reads everything.",
  },
  {
    icon: "📦",
    name: "Ephemeral accounts",
    tone: "#ef476f",
    what: "World, 8 Views and a 5-chunk flight recorder exist only inside the rollup. The room PDA sponsors their rent, so players never pay for them.",
    code: "setup_core · setup_view · setup_rec",
    without: "Over 50 KB of per-match state would need rent deposits on Solana.",
  },
  {
    icon: "⏱",
    name: "Crank",
    tone: "#06d6a0",
    what: "A scheduled task calls tick() every 50 ms. It runs 20 simulation steps a second with no game server anywhere.",
    code: "start_match → ScheduleCrankCpi(50 ms)",
    without: "Someone would have to run a server that sends every tick.",
  },
  {
    icon: "🎲",
    name: "VRF",
    tone: "#c77dff",
    what: "One verifiable seed rolls spawns, loot, bot behaviour and every zone centre. It's written into the sealed World and published at lights-on.",
    code: "start_match → on_seed (vrf callback)",
    without: "The host could pick spawns, or players could predict the zone.",
  },
  {
    icon: "⚡",
    name: "Magic Action",
    tone: "#4cc9f0",
    what: "When the room commits back to Solana, a post-commit action runs settle(): it pays the staked pot from the room's bank and writes the leaderboard.",
    code: "finish → commit + settle (#[action])",
    without: "Payouts would need a trusted relayer or a second, separate transaction.",
  },
  {
    icon: "🪪",
    name: "Gasless session keys",
    tone: "#ff8c42",
    what: "Your browser makes a key with 0 SOL. The ER doesn't charge fees, so every move, shot and heartbeat is signed silently, with no popup mid-match.",
    code: "input(dx, dy, aim, buttons, seq) × ~20/s",
    without: "A wallet popup for every step.",
  },
  {
    icon: "🔁",
    name: "Delegation & commit",
    tone: "#8ecae6",
    what: "Rooms live on Solana, are delegated to the TEE for play, and are committed back after each night, so results and money settle on L1.",
    code: "create_room · delegate_room · finish",
    without: "Results would stay stuck in the rollup.",
  },
];

const TIMELINE: { layer: "SOLANA" | "TEE ROLLUP"; ix: string; title: string; body: string }[] = [
  { layer: "SOLANA", ix: "create_room · delegate_room", title: "A table is built", body: "Room PDA created on Solana and delegated to the TEE validator." },
  { layer: "TEE ROLLUP", ix: "setup_core · setup_view × 8 · setup_rec × 5", title: "Sealed rooms inside", body: "Ephemeral World / View / Recorder accounts, each with its own reader list." },
  { layer: "TEE ROLLUP", ix: "claim_room · join", title: "Players sit down", body: "join rewrites your View's permission so only your session key can read it." },
  { layer: "SOLANA", ix: "buy_ticket", title: "Staked nights only", body: "Your wallet pays the stake into the room's bank and funds your session key." },
  { layer: "TEE ROLLUP", ix: "start_match → on_seed", title: "VRF rolls the night", body: "Seed lands in the sealed World. Spawns, loot and the zone plan are derived from it." },
  { layer: "TEE ROLLUP", ix: "tick × 1,800–4,200", title: "20 ticks a second", body: "The crank simulates the night (the host picks 1:30, 2:15 or 3:30) and writes each seat only what its flashlight hits." },
  { layer: "TEE ROLLUP", ix: "finish", title: "Lights on", body: "World + Recorder flip to public. Anyone can now replay and verify the night." },
  { layer: "SOLANA", ix: "commit → settle", title: "Magic Action settles", body: "The pot is paid to the winner's wallet and the leaderboard is updated on L1." },
];

const Y = <span className="m-yes">✓</span>;
const N = <span className="m-no">✕</span>;

export function How() {
  return (
    <div className="page how how2">
      <TopBar active="how" />

      <header className="how-hero">
        <div className="kicker">
          <span className="dot" /> BUILT ON MAGICBLOCK · 8 BUILDING BLOCKS · DEVNET
        </div>
        <h1>
          Fog of war that <em>the chain itself</em> can't break.
        </h1>
        <p className="lead">
          On a normal blockchain every account is public, so a wallhack is just an RPC call. BLACKOUT runs each night inside a <b>MagicBlock Private Ephemeral Rollup</b>,
          and uses <b>ephemeral permissions</b> to decide, account by account, who may read what. Not even we can see where you are.
        </p>
        <div className="how-nums">
          <div>
            <b>20</b>
            <span>ticks / second, on-chain</span>
          </div>
          <div>
            <b>0</b>
            <span>game servers</span>
          </div>
          <div>
            <b>0 SOL</b>
            <span>to play a free night</span>
          </div>
          <div>
            <b>8</b>
            <span>private views per match</span>
          </div>
        </div>
      </header>

      <PeekConsole />

      <section className="how-sec">
        <h2>Every building block, doing real work</h2>
        <p className="sec-sub">Take any one of these out and the game stops working. Each card names the instruction that uses it.</p>
        <div className="blocks">
          {BLOCKS.map((b) => (
            <div key={b.name} className="block" style={{ ["--t" as any]: b.tone }}>
              <div className="block-top">
                <span className="block-icon">{b.icon}</span>
                <h3>{b.name}</h3>
              </div>
              <p>{b.what}</p>
              <code>{b.code}</code>
              <small>
                <b>Without it:</b> {b.without}
              </small>
            </div>
          ))}
        </div>
      </section>

      <section className="how-sec">
        <h2>One night, end to end</h2>
        <p className="sec-sub">Gold steps happen on Solana. Purple steps happen inside the TEE rollup.</p>
        <ol className="timeline">
          {TIMELINE.map((t, i) => (
            <li key={i} className={t.layer === "SOLANA" ? "l1" : "er"}>
              <span className="tl-dot">{i + 1}</span>
              <div>
                <div className="tl-layer">{t.layer}</div>
                <h4>{t.title}</h4>
                <p>{t.body}</p>
                <code>{t.ix}</code>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="how-sec">
        <h2>Who can read what</h2>
        <p className="sec-sub">Enforced by the TEE validator's permission checks on every read.</p>
        <div className="matrix">
          <div className="mx-row head">
            <span />
            <span>you</span>
            <span>other players</span>
            <span>spectators · RPC</span>
            <span>after lights-on</span>
          </div>
          <div className="mx-row">
            <span>The room: names, alive count, kill feed, current zone</span>
            {Y}
            {Y}
            {Y}
            {Y}
          </div>
          <div className="mx-row">
            <span>Your view: you, plus what your flashlight hits</span>
            {Y}
            {N}
            {N}
            {Y}
          </div>
          <div className="mx-row">
            <span>The World: every position, bullet and loot crate</span>
            {N}
            {N}
            {N}
            {Y}
          </div>
          <div className="mx-row">
            <span>The VRF seed and future zone circles</span>
            {N}
            {N}
            {N}
            {Y}
          </div>
          <div className="mx-row">
            <span>The 10 Hz flight recorder (the replay)</span>
            {N}
            {N}
            {N}
            {Y}
          </div>
        </div>
        <p className="dim small">No ghosting: when you die your view is emptied, so dead players can't call out positions. Bots follow the same vision rules, inside the TEE.</p>
      </section>

      <section className="how-sec">
        <h2>The architecture</h2>
        <svg viewBox="0 0 900 470" className="diagram" role="img" aria-label="BLACKOUT architecture">
          <rect x={10} y={10} width={880} height={300} rx={14} fill="none" stroke="#a64dff" strokeDasharray="6 6" />
          <text x={28} y={36} fill="#a64dff" fontSize={13} fontWeight={700}>
            PRIVATE EPHEMERAL ROLLUP · Intel TDX TEE · devnet-tee.magicblock.app
          </text>
          <Box x={30} y={56} w={250} h={110} title="Room (public)" sub={"lobby, names, alive count,\nkill feed, zone circle\npermission: anyone"} tone="#4cc9f0" />
          <Box x={320} y={56} w={250} h={110} title="World (sealed)" sub={"all positions, bullets, loot,\nVRF seed, zone plan\npermission: ZERO readers"} tone="#ef476f" />
          <Box x={610} y={56} w={260} h={110} title="View × 8 (private)" sub={"what seat i may see this tick\ncomputed in the TEE\npermission: seat i only"} tone="#ffd166" />
          <Box x={30} y={186} w={250} h={104} title="Crank · 20 Hz" sub={"tick(): move, shoot, loot,\nzone, vision, sound, bots\nno server anywhere"} tone="#06d6a0" />
          <Box x={320} y={186} w={250} h={104} title="VRF" sub={"spawns, loot rolls, every\nzone centre, sealed until\neach circle is announced"} tone="#c77dff" />
          <Box x={610} y={186} w={260} h={104} title="Recorder × 5 (sealed)" sub={"10 Hz flight recorder\nflipped public at the end\n→ the lights-on replay"} tone="#ff8c42" />
          <rect x={10} y={340} width={880} height={120} rx={14} fill="none" stroke="#ffd166" strokeDasharray="6 6" />
          <text x={28} y={366} fill="#ffd166" fontSize={13} fontWeight={700}>
            SOLANA (base layer)
          </text>
          <Box x={30} y={380} w={260} h={68} title="Room PDA (delegated)" sub={"committed after every night"} tone="#4cc9f0" />
          <Box x={320} y={380} w={250} h={68} title="settle · Magic Action" sub={"runs right after the commit"} tone="#06d6a0" />
          <Box x={610} y={380} w={260} h={68} title="Leaderboard + Bank" sub={"staked wins · SOL won · pots"} tone="#ffd166" />
          <path d="M445 166 L445 186" stroke="#666" />
          <path d="M570 110 L610 110" stroke="#ffd166" markerEnd="url(#a)" />
          <path d="M445 310 L445 380" stroke="#06d6a0" markerEnd="url(#a)" />
          <path d="M570 414 L610 414" stroke="#06d6a0" markerEnd="url(#a)" />
          <defs>
            <marker id="a" viewBox="0 0 10 10" refX={9} refY={5} markerWidth={7} markerHeight={7} orient="auto-start-reverse">
              <path d="M0 0 L10 5 L0 10 z" fill="#aaa" />
            </marker>
          </defs>
        </svg>
      </section>

      <section className="how-sec">
        <h2>Check it yourself</h2>
        <div className="verify-links">
          <a href={explorerAddr(PROGRAM_ID.toBase58())} target="_blank" rel="noreferrer">
            <b>BLACKOUT program</b>
            <code>{short(PROGRAM_ID.toBase58())}</code>
          </a>
          <a href={explorerAddr(TEE_VALIDATOR.toBase58())} target="_blank" rel="noreferrer">
            <b>TEE validator</b>
            <code>{short(TEE_VALIDATOR.toBase58())}</code>
          </a>
          <a href={explorerAddr(boardPda().toBase58())} target="_blank" rel="noreferrer">
            <b>Leaderboard account</b>
            <code>{short(boardPda().toBase58())}</code>
          </a>
          <a href={explorerAddr(roomPda(1).toBase58())} target="_blank" rel="noreferrer">
            <b>Room 1 (delegated)</b>
            <code>{short(roomPda(1).toBase58())}</code>
          </a>
        </div>
        <p className="dim small">After every night, the verdict screen's VERIFY tab takes the revealed VRF seed, re-derives every spawn, loot roll and zone circle in your browser, and checks them against the unsealed World.</p>
      </section>

      <div className="how-cta">
        <h2>Now go play in the dark.</h2>
        <button className="btn primary huge" onClick={() => go("/")}>
          ENTER THE YARD
        </button>
      </div>
    </div>
  );
}
