// Claim a MagicBlock Quest: the player signs with their wallet (no fee) and pastes their X post.
// Every claim waits for the operator's approval before it's sent to MagicBlock Quests.
import { useEffect, useState } from "react";
import { TopBar } from "./TopBar";
import { useStore } from "../game/store";
import { QUESTS, claimMessage } from "../game/quests";
import { connectWallet, signText } from "../game/wallet";

type Claim = { quest: number; wallet: string; post: string; at: number; status: "pending" | "approved" | "rejected"; note?: string };

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const short = (k: string) => `${k.slice(0, 4)}…${k.slice(-4)}`;
const STATUS_TEXT = {
  pending: "Submitted · waiting for review",
  approved: "Approved · your points arrive with the next MagicBlock payout",
  rejected: "Not approved",
} as const;

export function Claim() {
  const wallet = useStore((s) => s.wallet);
  const toast = useStore((s) => s.toast);
  const [questId, setQuestId] = useState(QUESTS[0].id);
  const [post, setPost] = useState("");
  const [busy, setBusy] = useState(false);
  const [claim, setClaim] = useState<Claim | null>(null);
  const quest = QUESTS.find((q) => q.id === questId)!;

  useEffect(() => {
    setClaim(null);
    if (!wallet) return;
    fetch(`/api/claim?quest=${questId}&wallet=${wallet}`)
      .then((r) => r.json())
      .then((j) => setClaim(j.claim ?? null))
      .catch(() => {});
  }, [wallet, questId]);

  const submit = async () => {
    setBusy(true);
    try {
      const pk = wallet ?? (await connectWallet());
      const link = post.trim();
      const at = Date.now();
      const sig = await signText(claimMessage(questId, pk, link, at));
      const r = await fetch("/api/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ quest: questId, wallet: pk, post: link, at, sig: b64(sig) }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Couldn't submit");
      setClaim(j.claim);
      toast(j.already ? "You've already claimed this quest" : "Claim submitted 🔦", true);
    } catch (e: any) {
      toast(e?.message?.includes("User rejected") ? "Signature cancelled" : e?.message ?? "Couldn't submit");
    } finally {
      setBusy(false);
    }
  };

  const locked = claim && claim.status !== "rejected";
  return (
    <div className="page claim">
      <TopBar />
      <header className="cl-hero">
        <div className="kicker">
          <span className="dot" /> MAGICBLOCK QUESTS
        </div>
        <h1>Claim your quest</h1>
        <p className="lead">Finished a BLACKOUT quest? Send your post. Every claim is checked by hand, then your points go out with MagicBlock's next payout.</p>
      </header>

      <div className="cl-card">
        {QUESTS.length > 1 && (
          <div className="cl-tabs">
            {QUESTS.map((q) => (
              <button key={q.id} className={q.id === questId ? "on" : ""} onClick={() => setQuestId(q.id)}>
                {q.title}
              </button>
            ))}
          </div>
        )}
        <h2>{quest.title}</h2>
        <p className="cl-text">{quest.text}</p>
        <ol className="cl-steps">
          {quest.steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>

        <div className="cl-form">
          <label>Wallet</label>
          <div className="cl-wallet">{wallet ? <code>{short(wallet)}</code> : <span>Connect the wallet you use on MagicBlock Quests</span>}</div>
          <p className="cl-warn">⚠ Connect the same wallet as your MagicBlock Quests account, the one that pressed Start on this quest. Points can only go to that wallet.</p>

          <label htmlFor="cl-post">Link to your X post</label>
          <input id="cl-post" placeholder="https://x.com/you/status/…" value={locked ? claim!.post : post} onChange={(e) => setPost(e.target.value)} disabled={!!locked || busy} />

          {claim && (
            <div className={`cl-status ${claim.status}`}>
              <b>{STATUS_TEXT[claim.status]}</b>
              {claim.note && <span>{claim.note}</span>}
              {claim.status === "rejected" && <span>Fix it and send again.</span>}
            </div>
          )}

          {!locked && (
            <button className="btn primary huge" onClick={submit} disabled={busy || (!!wallet && !post.trim())}>
              {busy ? "SIGNING…" : wallet ? "SIGN & SUBMIT" : "CONNECT WALLET"}
            </button>
          )}
          <p className="cl-hint">Signing is free: it only proves the wallet is yours. No transaction is sent.</p>
        </div>
      </div>
    </div>
  );
}
