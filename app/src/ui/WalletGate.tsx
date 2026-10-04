import { useEffect, useState } from "react";
import { useStore } from "../game/store";
import { WALLETS, connectWallet, localNameFor, saveWalletName } from "../game/wallet";
import { saveName } from "../game/identity";
import { aliasFor } from "./Board";

/** "Who goes there?" — connect a wallet and pick a callsign before entering the Yard. */
export function WalletGate() {
  const gate = useStore((s) => s.walletGate);
  const wallet = useStore((s) => s.wallet);
  const profile = useStore((s) => s.profile);
  const set = useStore((s) => s.set);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState("");
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
  const close = () => set({ walletGate: null });
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
        {!wallet ? (
          <>
            <div className="vc-kicker">WHO GOES THERE?</div>
            <h2>Connect your wallet to enter the Yard</h2>
            <p>Your wallet is your identity: your callsign, wins and kills are saved to Solana and follow you to any device. Playing is still free and gasless — no popups mid-match.</p>
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
            <small>Devnet only. We never ask you to sign a payment to play.</small>
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
