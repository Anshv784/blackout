import { useEffect, useState } from "react";
import { useStore } from "../game/store";
import { WALLETS, connectWallet, localNameFor, saveWalletName, setGuest } from "../game/wallet";
import { saveName } from "../game/identity";
import { aliasFor } from "./Board";

/** "Who goes there?": connect a wallet (saved + ranked) or play as a guest (nothing saved). */
export function WalletGate() {
  const gate = useStore((s) => s.walletGate);
  const wallet = useStore((s) => s.wallet);
  const profile = useStore((s) => s.profile);
  const set = useStore((s) => s.set);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [guestStep, setGuestStep] = useState(false);
  const curName = useStore((s) => s.name);
  const [, rerender] = useState(0);

  useEffect(() => {
    // wallets inject a moment after load
    const t = setTimeout(() => rerender((x) => x + 1), 600);
    return () => clearTimeout(t);
  }, [gate]);

  useEffect(() => {
    if (wallet) setName(profile?.name || localNameFor(wallet) || aliasFor(wallet).replace(" ", ""));
  }, [wallet, profile]);

  if (!gate) return null;
  const close = () => {
    setGuestStep(false);
    set({ walletGate: null });
  };
  const enterAsGuest = () => {
    const n = (name || curName || "GHOST").toUpperCase().replace(/[^A-Z0-9_\-]/g, "").slice(0, 12) || "GHOST";
    saveName(n);
    setGuest(true);
    set({ name: n, walletGate: null });
    setGuestStep(false);
    gate.then();
  };
  const needsName = wallet && !localNameFor(wallet);

  const finish = () => {
    const n = name.toUpperCase().replace(/[^A-Z0-9_\-]/g, "").slice(0, 12) || "GHOST";
    saveWalletName(wallet!, n);
    saveName(n);
    set({ name: n, walletGate: null });
    gate.then();
  };

  return (
    <div className="wgate" onClick={close}>
      <div className="wgate-card" onClick={(e) => e.stopPropagation()}>
        <div className="wgate-eye" />
        {!wallet && guestStep && !gate.walletOnly ? (
          <>
            <div className="wgate-head">
              <div className="vc-kicker">PLAYING AS A GUEST</div>
              <h2>Pick a callsign</h2>
            </div>
            <div className="wgate-body">
            <input
              className="wgate-input"
              autoFocus
              value={name || curName}
              maxLength={12}
              onChange={(e) => setName(e.target.value.toUpperCase().replace(/[^A-Z0-9_\-]/g, "").slice(0, 12))}
              onKeyDown={(e) => e.key === "Enter" && enterAsGuest()}
            />
            <div className="guest-warn">
              ⚠ As a guest, your nights <b>aren't saved</b> and you <b>won't appear on the leaderboard</b>. Staked nights, the only ones that count, need a wallet. You can connect one any time.
            </div>
            <button className="btn primary huge" onClick={enterAsGuest}>
              ENTER AS GUEST
            </button>
            <a className="side-link" onClick={() => setGuestStep(false)}>
              ← connect a wallet instead
            </a>
            </div>
          </>
        ) : !wallet ? (
          <>
            <div className="wgate-head">
            <div className="vc-kicker">{gate.walletOnly ? "STAKED NIGHT" : "WHO GOES THERE?"}</div>
            <h2>{gate.walletOnly ? "Staked nights need a wallet" : "Enter the Yard"}</h2>
            <p>
              {gate.walletOnly
                ? "Every staker puts in the same amount and the winner takes the whole pot, paid straight to their wallet on Solana. Connect one to sit at the table."
                : "Connect a wallet to keep your callsign, play staked nights and get ranked on the leaderboard (staked wins only). Or jump straight in as a guest. Either way, playing is free and gasless, with no popups mid-match."}
            </p>
            </div>
            <div className="wgate-body">
            <div className="wgate-list">
              {WALLETS.map((w) => {
                const installed = !!w.get();
                return installed ? (
                  <button
                    key={w.id}
                    className="wgate-wallet"
                    disabled={!!busy}
                    onClick={async () => {
                      setErr(null);
                      setBusy(w.id);
                      try {
                        const pk = await connectWallet(w.id);
                        if (localNameFor(pk)) {
                          set({ walletGate: null });
                          gate.then();
                        }
                      } catch (e: any) {
                        setErr(String(e?.message ?? e));
                      } finally {
                        setBusy(null);
                      }
                    }}
                  >
                    <span>{w.name}</span>
                    <em>{busy === w.id ? "connecting…" : "detected"}</em>
                  </button>
                ) : (
                  <a key={w.id} className="wgate-wallet off" href={w.url} target="_blank" rel="noreferrer">
                    <span>{w.name}</span>
                    <em>install ↗</em>
                  </a>
                );
              })}
            </div>
            {err && <div className="wgate-err">{err}</div>}
            {gate.walletOnly ? (
              <small>Guests can't stake: the pot is paid to your wallet and staked wins are what the leaderboard ranks.</small>
            ) : (
              <>
            <div className="wgate-or">
              <span>or</span>
            </div>
            <button className="btn wide" onClick={() => setGuestStep(true)}>
              PLAY AS GUEST
            </button>
            <small>Guests play the same game — but nothing is saved and you're not ranked. Devnet only; we never ask you to sign a payment to play.</small>
              </>
            )}
            </div>
          </>
        ) : needsName ? (
          <>
            <div className="vc-kicker">NEW SURVIVOR</div>
            <h2>Choose your callsign</h2>
            <p>This is the name the Yard will remember. It's written to Solana with your stats after your first night.</p>
            <input
              className="wgate-input"
              autoFocus
              value={name}
              maxLength={12}
              onChange={(e) => setName(e.target.value.toUpperCase().replace(/[^A-Z0-9_\-]/g, "").slice(0, 12))}
              onKeyDown={(e) => e.key === "Enter" && finish()}
            />
            <button className="btn primary huge" onClick={finish}>
              ENTER THE YARD
            </button>
            <code className="wgate-addr">{wallet}</code>
          </>
        ) : null}
      </div>
    </div>
  );
}
