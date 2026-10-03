import { TopBar } from "./TopBar";
import { go } from "../App";

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

export function How() {
  return (
    <div className="page how">
      <TopBar active="how" />
      <h1>How BLACKOUT works</h1>
      <p className="lead">
        On a normal blockchain, fog of war is impossible: every account is public, so anyone can read where every player is standing. BLACKOUT runs the entire match
        inside a <b>MagicBlock Private Ephemeral Rollup</b> — a Solana runtime inside an Intel TDX enclave — and uses its permission system to decide, per account, who may
        read what.
      </p>

      <svg viewBox="0 0 900 470" className="diagram" role="img" aria-label="BLACKOUT architecture">
        <rect x={10} y={10} width={880} height={300} rx={14} fill="none" stroke="#a64dff" strokeDasharray="6 6" />
        <text x={28} y={36} fill="#a64dff" fontSize={13} fontWeight={700}>
          PRIVATE EPHEMERAL ROLLUP · Intel TDX TEE · devnet-tee.magicblock.app
        </text>
        <Box x={30} y={56} w={250} h={110} title="Room (public)" sub={"lobby, names, alive count,\nkill feed, zone circle\npermission: anyone"} tone="#4cc9f0" />
        <Box x={320} y={56} w={250} h={110} title="World (sealed)" sub={"all positions, bullets, loot,\nVRF seed, zone plan\npermission: ZERO readers"} tone="#ef476f" />
        <Box x={610} y={56} w={260} h={110} title="View × 8 (private)" sub={"what seat i may see this tick\ncomputed in the TEE\npermission: seat i only"} tone="#ffd166" />
        <Box x={30} y={186} w={250} h={104} title="Crank · 20 Hz" sub={"tick(): move, shoot, loot,\nzone, vision, sound, bots\nno server anywhere"} tone="#06d6a0" />
        <Box x={320} y={186} w={250} h={104} title="VRF" sub={"spawns, loot rolls, every\nzone centre — sealed until\neach circle is announced"} tone="#c77dff" />
        <Box x={610} y={186} w={260} h={104} title="Recorder × 5 (sealed)" sub={"10 Hz flight recorder\nflipped public at the end\n→ the lights-on replay"} tone="#ff8c42" />
        <rect x={10} y={340} width={880} height={120} rx={14} fill="none" stroke="#4cc9f0" strokeDasharray="6 6" />
        <text x={28} y={366} fill="#4cc9f0" fontSize={13} fontWeight={700}>
          SOLANA (base layer)
        </text>
        <Box x={30} y={380} w={260} h={68} title="Room PDA (delegated)" sub={"committed after every match"} tone="#4cc9f0" />
        <Box x={320} y={380} w={250} h={68} title="settle · Magic Action" sub={"runs right after the commit"} tone="#06d6a0" />
        <Box x={610} y={380} w={260} h={68} title="Leaderboard + Bank" sub={"wins, kills · staked pots"} tone="#ffd166" />
        <path d="M445 166 L445 186" stroke="#666" />
        <path d="M570 110 L610 110" stroke="#ffd166" markerEnd="url(#a)" />
        <path d="M445 310 L445 380" stroke="#06d6a0" markerEnd="url(#a)" />
        <defs>
          <marker id="a" viewBox="0 0 10 10" refX={9} refY={5} markerWidth={7} markerHeight={7} orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" fill="#aaa" />
          </marker>
        </defs>
      </svg>

      <div className="steps">
        <div>
          <h3>1 · Join with no wallet</h3>
          <p>
            Your browser generates a session key. The Private ER is gasless, so a key with 0 SOL can play. Taking a seat calls <code>join</code>, which rewrites your
            seat's View permission so only your key may read it — authenticated against the TEE with a signed challenge.
          </p>
        </div>
        <div>
          <h3>2 · VRF seeds a sealed match</h3>
          <p>
            <code>start_match</code> requests MagicBlock VRF and schedules a crank. The VRF callback derives spawns, loot and the zone plan straight into the World
            account — which nobody can read.
          </p>
        </div>
        <div>
          <h3>3 · 20 ticks a second inside the TEE</h3>
          <p>
            Every 50 ms the crank runs <code>tick</code>: movement, bullets, damage, the zone, on-chain bots, and line-of-sight. For each seat it writes only what that
            player's flashlight hits (cone + walls), a 2-tile "feel" circle, muzzle flashes, and directional sound pings for what you can't see.
          </p>
        </div>
        <div>
          <h3>4 · Lights on</h3>
          <p>
            At the final kill anyone calls <code>finish</code>: World and Recorder permissions flip to public, the seed becomes verifiable, and the replay unlocks. The
            room commits to Solana with a Magic Action that pays the pot and updates the leaderboard. <code>reset</code> re-seals everything for the next match.
          </p>
        </div>
      </div>
      <p className="dim">No ghosting: dead players' views are emptied. Spectators see nothing until the reveal. Bots use the same vision rules, computed in the TEE.</p>
    </div>
  );
}
