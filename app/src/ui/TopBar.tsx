import { useEffect, useRef, useState } from "react";
import { FullscreenButton } from "./Fullscreen";
import { useStore } from "../game/store";
import { saveName } from "../game/identity";
import { disconnectWallet, requireWallet, saveWalletName } from "../game/wallet";
import { SoundToggle } from "./SoundToggle";
import { go } from "../App";

export function Logo({ onClick }: { onClick?: () => void }) {
  return (
    <a className="logo-mark" onClick={onClick ?? (() => go("/"))}>
      <svg viewBox="0 0 32 32" width="22" height="22" aria-hidden>
        <circle cx="16" cy="16" r="14" fill="none" stroke="#a64dff" strokeWidth="1.5" opacity=".7" />
        <circle cx="16" cy="16" r="5" fill="#ffe9b0" />
      </svg>
      <span>BLACKOUT</span>
    </a>
  );
}

function Callsign() {
  const name = useStore((s) => s.name);
  const set = useStore((s) => s.set);
  const [edit, setEdit] = useState(false);
  const inp = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (edit) inp.current?.focus();
  }, [edit]);
  return edit ? (
    <input
      ref={inp}
      className="chip-input"
      value={name}
      maxLength={12}
      onChange={(e) => {
        const v = e.target.value.toUpperCase().replace(/[^A-Z0-9_\-]/g, "").slice(0, 12);
        saveName(v);
        const w = useStore.getState().wallet;
        if (w) saveWalletName(w, v);
        set({ name: v });
      }}
      onBlur={() => setEdit(false)}
      onKeyDown={(e) => e.key === "Enter" && setEdit(false)}
    />
  ) : (
    <button className="chip-btn" onClick={() => setEdit(true)} title="Change your callsign">
      <i className="dot" /> {name || "GHOST"} <em className="cs-pen">✎</em>
    </button>
  );
}

function Wallet() {
  const wallet = useStore((s) => s.wallet);
  const toast = useStore((s) => s.toast);
  const profile = useStore((s) => s.profile);
  const [open, setOpen] = useState(false);
  return wallet ? (
    <div className="wallet-menu" onMouseLeave={() => setOpen(false)}>
      <button className="chip-btn" onClick={() => setOpen(!open)} title="Wins and payouts go here">
        ◎ {wallet.slice(0, 4)}…{wallet.slice(-4)} <em>▾</em>
      </button>
      {open && (
        <div className="wm-pop">
          <div className="wm-profile">
            <b>{useStore.getState().name}</b>
            <span>
              {profile ? `${profile.wins} wins · ${profile.kills} kills · ${profile.games} nights` : "no nights on record yet"}
            </span>
          </div>
          <button
            onClick={() => {
              navigator.clipboard?.writeText(wallet);
              toast("Address copied");
              setOpen(false);
            }}
          >
            Copy address
          </button>
          <button
            className="danger"
            onClick={async () => {
              await disconnectWallet();
              setOpen(false);
              toast("Wallet disconnected — you're playing with your browser key");
            }}
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  ) : (
    <>
      <GuestTag />
      <button
        className="chip-btn connect"
        onClick={() => useStore.getState().set({ walletGate: { then: () => {} } })}
        title="Connect to save your nights and appear on the leaderboard"
      >
        ◎ <span className="cw-word">connect wallet</span>
      </button>
    </>
  );
}

function GuestTag() {
  const guest = useStore((s) => s.guest);
  return guest ? (
    <span className="chip-btn static guest-tag" title="Guest: your nights aren't saved and you're not on the leaderboard">
      GUEST · not saved
    </span>
  ) : null;
}

export function TopBar({ active }: { active?: "play" | "board" | "how" }) {
  return (
    <header className="topbar">
      <Logo />
      <nav>
        <a className={active === "play" ? "on" : ""} data-short="Play" onClick={() => go("/")}>
          Play
        </a>
        <a className={active === "board" ? "on" : ""} data-short="Board" onClick={() => go("/board")}>
          Leaderboard
        </a>
        <a className={active === "how" ? "on" : ""} data-short="How" onClick={() => go("/how")}>
          How it works
        </a>
        <a data-short="Story" onClick={() => (window as any).__replayIntro?.()}>Story</a>
      </nav>
      <div className="topbar-right">
        <Callsign />
        <Wallet />
        <SoundToggle />
        <FullscreenButton className="chip-btn" />
      </div>
    </header>
  );
}
