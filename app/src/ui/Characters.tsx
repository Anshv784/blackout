// The Character page: pick your operator, outfit, gun finish and signature emote. Saved on this
// device; everyone at your table sees it (it travels with your seat).
import { lazy, Suspense, useState } from "react";
import { TopBar } from "./TopBar";
import { go } from "../App";
import { CHARACTERS, ROSTER, OUTFITS, FINISHES, EMOTES, SKINS, useLook } from "../game/look";
import { SkinSwatch } from "./SkinSwatch";
import { EmoteGlyph } from "./EmoteWheel";
import { WEAPON_NAME } from "../chain/layout";
import { GunIcon } from "./Icons";
import { useStore } from "../game/store";

const CharacterStage = lazy(() => import("../scene/CharacterStage").then((m) => ({ default: m.CharacterStage })));
const PREVIEW_GUNS = [3, 1, 2, 4, 5, 6, 7, 0];

export function Characters() {
  const { look, set } = useLook();
  const [weapon, setWeapon] = useState(3);
  const [emoteAt, setEmoteAt] = useState(0);
  const [tab, setTab] = useState<"outfit" | "finish" | "skin" | "emote">("outfit");
  const name = useStore((s) => s.name);
  const ch = CHARACTERS[look.char];
  const play = (i: number) => {
    set({ emote: i });
    setEmoteAt(performance.now());
  };
  return (
    <div className="chars-page">
      <TopBar active="chars" />
      <main className="cs-main">
        <section className="cs-roster">
          <label className="cs-label">OPERATORS</label>
          <div className="cs-grid">
            {ROSTER.map((c) => (
              <button key={c.id} className={`cs-card ${look.char === c.id ? "on" : ""}`} onClick={() => set({ char: c.id })}>
                <img src={`/models/chars/thumbs/${c.key}.png`} alt="" loading="lazy" />
                <b>{c.name}</b>
                <span>{c.role}</span>
              </button>
            ))}
          </div>
          <p className="cs-note">Everyone at your table sees your operator, outfit and gun finish. Saved on this device.</p>
        </section>

        <section className="cs-center">
          <div className="cs-title">
            <span>{name || "SURVIVOR"}</span>
            <h1>{ch.name}</h1>
            <em>{ch.role}</em>
          </div>
          <Suspense fallback={<div className="cs-stage" />}>
            <CharacterStage look={look} weapon={weapon} emoteAt={emoteAt} />
          </Suspense>
          <div className="cs-guns">
            {PREVIEW_GUNS.map((w) => (
              <button key={w} className={weapon === w ? "on" : ""} title={WEAPON_NAME[w]} onClick={() => setWeapon(w)}>
                <GunIcon weapon={w} />
              </button>
            ))}
          </div>
        </section>

        <section className="cs-kit">
          <div className="lk">
            <div className="lk-tabs">
              {(["outfit", "finish", "skin", "emote"] as const).map((t) => (
                <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
                  {t === "finish" ? "GUN FINISH" : t === "skin" ? "GUN SKIN" : t.toUpperCase()}
                </button>
              ))}
            </div>
            <p className="lk-sub">
              {tab === "outfit" && "The tone of your operator's gear."}
              {tab === "finish" && "The colour of your guns' metal."}
              {tab === "skin" && "A pattern printed on every gun you carry."}
              {tab === "emote" && "Your signature. In a match press B for the wheel."}
            </p>
            <div className={`lk-grid ${tab === "emote" ? "wide" : ""}`}>
              {tab === "outfit" &&
                OUTFITS.map((o, i) => (
                  <button key={o.name} className={`lk-tile ${look.outfit === i ? "on" : ""}`} onClick={() => set({ outfit: i })}>
                    <i className="lk-fill" style={{ background: i === 0 ? "conic-gradient(from 40deg,#6b7a4a,#a08860,#3d4a5c,#7a4a3a,#6b7a4a)" : `linear-gradient(160deg, ${o.tint}, color-mix(in srgb, ${o.tint} 55%, #000))` }} />
                    <span>{o.name}</span>
                  </button>
                ))}
              {tab === "finish" &&
                FINISHES.map((f, i) => (
                  <button key={f.name} className={`lk-tile ${look.finish === i ? "on" : ""}`} onClick={() => set({ finish: i })}>
                    <i className="lk-fill" style={{ background: `linear-gradient(160deg, ${i === 0 ? "#5a606c" : f.tint}, color-mix(in srgb, ${i === 0 ? "#2a2d34" : f.tint} 45%, #000))` }} />
                    <span>{f.name}</span>
                  </button>
                ))}
              {tab === "skin" &&
                SKINS.map((k, i) => (
                  <button key={k.key} className={`lk-tile ${(look.skin ?? 0) === i ? "on" : ""}`} onClick={() => set({ skin: i })}>
                    <SkinSwatch i={i} big />
                    <span>{k.name}</span>
                  </button>
                ))}
              {tab === "emote" &&
                EMOTES.map((e, i) => (
                  <button key={e.key} className={`lk-tile emote ${look.emote === i ? "on" : ""}`} onClick={() => play(i)}>
                    <EmoteGlyph k={e.key} />
                    <span>{e.name}</span>
                  </button>
                ))}
            </div>
          </div>
          <button className="btn primary cs-done" onClick={() => go("/")}>
            DONE · BACK TO MENU
          </button>
        </section>
      </main>
    </div>
  );
}
