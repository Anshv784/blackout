// The Character page: pick your operator, outfit, gun finish and signature emote. Saved on this
// device; everyone at your table sees it (it travels with your seat).
import { lazy, Suspense, useState } from "react";
import { TopBar } from "./TopBar";
import { go } from "../App";
import { CHARACTERS, ROSTER, OUTFITS, FINISHES, EMOTES, SKINS, useLook } from "../game/look";
import { SkinSwatch } from "./SkinSwatch";
import { WEAPON_NAME } from "../chain/layout";
import { GunIcon } from "./Icons";
import { useStore } from "../game/store";

const CharacterStage = lazy(() => import("../scene/CharacterStage").then((m) => ({ default: m.CharacterStage })));
const PREVIEW_GUNS = [3, 1, 2, 4, 5, 6, 7, 0];

export function Characters() {
  const { look, set } = useLook();
  const [weapon, setWeapon] = useState(3);
  const [emoteAt, setEmoteAt] = useState(0);
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
          <div className="cs-panel">
            <label className="cs-label">OUTFIT</label>
            <div className="cs-swatches">
              {OUTFITS.map((o, i) => (
                <button key={o.name} className={look.outfit === i ? "on" : ""} onClick={() => set({ outfit: i })}>
                  <i style={{ background: i === 0 ? "conic-gradient(#6b7a4a,#a08860,#3d4a5c,#6b7a4a)" : o.tint }} />
                  <span>{o.name}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="cs-panel">
            <label className="cs-label">GUN FINISH</label>
            <div className="cs-swatches">
              {FINISHES.map((f, i) => (
                <button key={f.name} className={look.finish === i ? "on" : ""} onClick={() => set({ finish: i })}>
                  <i style={{ background: i === 0 ? "#3a3f4a" : f.tint }} />
                  <span>{f.name}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="cs-panel">
            <label className="cs-label">GUN SKIN</label>
            <div className="cs-swatches">
              {SKINS.map((k, i) => (
                <button key={k.key} className={(look.skin ?? 0) === i ? "on" : ""} onClick={() => set({ skin: i })}>
                  <SkinSwatch i={i} />
                  <span>{k.name}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="cs-panel">
            <label className="cs-label">
              SIGNATURE EMOTE <em>B opens the wheel in a match</em>
            </label>
            <div className="cs-emotes">
              {EMOTES.map((e, i) => (
                <button key={e.key} className={look.emote === i ? "on" : ""} onClick={() => play(i)}>
                  <span>{e.name}</span>
                  {look.emote === i && <b>★</b>}
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
