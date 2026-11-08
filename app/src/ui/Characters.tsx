// The Character page: pick your operator, outfit, gun finish and signature emote. Saved on this
// device; everyone at your table sees it (it travels with your seat).
import { lazy, Suspense, useState } from "react";
import { TopBar } from "./TopBar";
import { go } from "../App";
import { CHARACTERS, ROSTER, OUTFITS, FINISHES, EMOTES, SKINS, previewGun, skinOf, useLook, type SkinGroup } from "../game/look";
import { SkinSwatch } from "./SkinSwatch";
import { EmoteGlyph } from "./EmoteWheel";
import { WEAPON_NAME } from "../chain/layout";
import { GunIcon } from "./Icons";
import { useStore } from "../game/store";
import { loadCareer, favouriteGun, fmtTime } from "../game/career";

const GunStage = lazy(() => import("../scene/GunStage").then((m) => ({ default: m.GunStage })));
const CharacterStage = lazy(() => import("../scene/CharacterStage").then((m) => ({ default: m.CharacterStage })));
const PREVIEW_GUNS = [3, 1, 2, 4, 5, 6, 7, 0];
/** what each gun is, and its numbers (mirror of the program's WEAPONS table) */
const GUN_INFO: { type: string; dmg: number; rate: number; mag: number; range: number; note: string }[] = [
  { type: "pistol", dmg: 22, rate: 7, mag: 10, range: 16, note: "sidearm, never runs dry" },
  { type: "SMG", dmg: 11, rate: 2, mag: 30, range: 14, note: "sprays fast, close range" },
  { type: "shotgun", dmg: 65, rate: 16, mag: 5, range: 8, note: "five pellets, one room" },
  { type: "assault rifle", dmg: 15, rate: 3, mag: 30, range: 20, note: "the all-rounder" },
  { type: "bolt sniper", dmg: 80, rate: 30, mag: 5, range: 26, note: "two hits, loud" },
  { type: "marksman rifle", dmg: 38, rate: 9, mag: 10, range: 24, note: "semi-auto, mid range" },
  { type: "light machine gun", dmg: 13, rate: 2, mag: 60, range: 20, note: "pin a corner" },
  { type: "crossbow", dmg: 70, rate: 26, mag: 1, range: 26, note: "no sound, no flash" },
];
const bar = (v: number, max: number) => Math.max(0.06, Math.min(1, v / max));

const OUTFIT_NOTE = ["as issued", "forest greens", "sand and dust", "concrete grey", "night blue", "snow white", "dried red"];
const FINISH_NOTE = ["bare steel", "desert tan", "field olive", "polished white", "gold plate", "red anodised"];

export function Characters() {
  const { look, set } = useLook();
  // the gun you pick here is the one your operator carries on the home screen too
  const [weapon, setWeaponState] = useState(() => previewGun());
  const setWeapon = (w: number) => {
    setWeaponState(w);
    try {
      localStorage.setItem("bo-preview-gun", String(w));
    } catch {}
  };
  const [emoteAt, setEmoteAt] = useState(0);
  const [mode, setMode] = useState<"operator" | "guns">("operator");
  const [tab, setTab] = useState<"outfit" | "finish" | "skin" | "emote">("outfit");
  const [skinGroup, setSkinGroup] = useState<SkinGroup>(() => SKINS[skinOf(look, previewGun())]?.group ?? "classic");
  const tabs = mode === "guns" ? (["finish", "skin"] as const) : (["outfit", "emote"] as const);
  const curTab = (tabs as readonly string[]).includes(tab) ? tab : tabs[0];
  const gi = GUN_INFO[weapon];
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
          <div className="cs-mode">
            <button className={mode === "operator" ? "on" : ""} onClick={() => setMode("operator")}>
              OPERATOR
            </button>
            <button className={mode === "guns" ? "on" : ""} onClick={() => setMode("guns")}>
              GUNSMITH
            </button>
          </div>
          {mode === "operator" ? (
            <>
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
              <p className="cs-note">Everyone at your table sees your operator, outfit, gun finish and skins. Saved on this device.</p>
            </>
          ) : (
            <>
              <label className="cs-label">ARMORY</label>
              <div className="gs-list">
                {[0, 1, 2, 3, 5, 4, 6, 7].map((w) => (
                  <button key={w} className={`gs-item ${weapon === w ? "on" : ""}`} onClick={() => setWeapon(w)}>
                    <i className="gs-thumb">
                      <img src={`/models/guns/thumbs/${w}.webp`} alt="" loading="lazy" />
                    </i>
                    <div>
                      <b>{WEAPON_NAME[w]}</b>
                      <span>
                        {GUN_INFO[w].type}
                        {skinOf(look, w) > 0 && <em className="gs-skin">· {SKINS[skinOf(look, w)].name}</em>}
                      </span>
                      <em className="gs-dmg" title="damage per hit">
                        <i style={{ width: `${bar(GUN_INFO[w].dmg, 80) * 100}%` }} />
                      </em>
                    </div>
                  </button>
                ))}
              </div>
              <p className="cs-note">Each gun keeps its own skin. The finish colours all of them.</p>
            </>
          )}
        </section>

        <section className="cs-center">
          <div className="cs-title">
            <span>{mode === "guns" ? "GUNSMITH" : name || "SURVIVOR"}</span>
            <h1>{mode === "guns" ? WEAPON_NAME[weapon] : ch.name}</h1>
            <em>{mode === "guns" ? `${gi.type} · ${gi.note}` : ch.role}</em>
          </div>
          <Suspense fallback={<div className="cs-stage" />}>
            {mode === "guns" ? <GunStage weapon={weapon} finish={FINISHES[look.finish]?.tint} skin={skinOf(look, weapon)} /> : <CharacterStage look={look} weapon={weapon} emoteAt={emoteAt} />}
          </Suspense>
          {mode === "guns" && (
            <div className="gs-stats">
              {([
                ["DAMAGE", gi.dmg, 80],
                ["FIRE RATE", 30 / gi.rate, 15],
                ["MAGAZINE", gi.mag, 60],
                ["RANGE", gi.range, 26],
              ] as [string, number, number][]).map(([k, v, max]) => (
                <div key={k}>
                  <span>{k}</span>
                  <i>
                    <b style={{ width: `${bar(v, max) * 100}%` }} />
                  </i>
                </div>
              ))}
            </div>
          )}
          <div className="cs-guns" style={mode === "guns" ? { display: "none" } : undefined}>
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
              {tabs.map((t) => (
                <button key={t} className={curTab === t ? "on" : ""} onClick={() => setTab(t)}>
                  {t === "finish" ? "GUN FINISH" : t === "skin" ? "GUN SKIN" : t.toUpperCase()}
                </button>
              ))}
            </div>
            <p className="lk-sub">
              {curTab === "outfit" && "The tone of your operator's gear."}
              {curTab === "finish" && "The colour of your guns' metal."}
              {curTab === "skin" && (
                <>
                  Skin for the <b>{WEAPON_NAME[weapon]}</b>. Pick another gun in the armory to give it its own.
                </>
              )}
              {curTab === "emote" && "Your signature. In a match press B for the wheel."}
            </p>
            {curTab === "skin" && (
              <div className="sk-groups">
                {(
                  [
                    ["classic", "CLASSIC"],
                    ["live", "LIVE"],
                    ["legend", "LEGENDS"],
                  ] as [SkinGroup, string][]
                ).map(([g, label]) => (
                  <button key={g} className={`${g} ${skinGroup === g ? "on" : ""}`} onClick={() => setSkinGroup(g)}>
                    {label}
                    <i>{SKINS.filter((k) => k.group === g).length}</i>
                  </button>
                ))}
              </div>
            )}
            {curTab === "skin" && skinGroup === "legend" && (
              <div className="sk-lore">
                {SKINS[skinOf(look, weapon)]?.lore ? (
                  <>
                    <b>{SKINS[skinOf(look, weapon)].name.toUpperCase()}</b>
                    <p>{SKINS[skinOf(look, weapon)].lore}</p>
                  </>
                ) : (
                  <p>Each legend is a story told in motion. Pick one to read it.</p>
                )}
              </div>
            )}
            <div className={`lk-grid ${curTab === "emote" ? "wide" : curTab === "skin" ? (skinGroup === "legend" ? "skins legends" : "skins") : ""}`}>
              {curTab === "outfit" &&
                OUTFITS.map((o, i) => (
                  <button key={o.name} className={`lk-tile op ${look.outfit === i ? "on" : ""}`} onClick={() => set({ outfit: i })}>
                    <i className="lk-fill lk-op" style={{ ["--tint" as string]: i === 0 ? "#9a8a70" : o.tint }}>
                      <img src={`/models/chars/thumbs/${ch.key}.png`} alt="" />
                      {i > 0 && <b style={{ background: o.tint, WebkitMaskImage: `url(/models/chars/thumbs/${ch.key}.png)`, maskImage: `url(/models/chars/thumbs/${ch.key}.png)` }} />}
                    </i>
                    <span>
                      {o.name}
                      <em>{OUTFIT_NOTE[i]}</em>
                    </span>
                  </button>
                ))}
              {curTab === "finish" &&
                FINISHES.map((f, i) => {
                  const c = i === 0 ? "#8a909c" : f.tint;
                  return (
                    <button key={f.name} className={`lk-tile op ${look.finish === i ? "on" : ""}`} onClick={() => set({ finish: i })}>
                      <i className="lk-fill lk-gun" style={{ ["--tint" as string]: c }}>
                        <img src={`/models/guns/thumbs/${weapon}.webp`} alt="" />
                        {i > 0 && <b style={{ background: c, WebkitMaskImage: `url(/models/guns/thumbs/${weapon}.webp)`, maskImage: `url(/models/guns/thumbs/${weapon}.webp)` }} />}
                      </i>
                      <span>
                        {f.name}
                        <em>{FINISH_NOTE[i] ?? ""}</em>
                      </span>
                    </button>
                  );
                })}
              {curTab === "skin" &&
                SKINS.map((k, i) => ({ k, i }))
                  .filter(({ k }) => k.group === skinGroup)
                  .map(({ k, i }) => (
                    <button
                      key={k.key}
                      className={`lk-tile ${skinOf(look, weapon) === i ? "on" : ""}`}
                      title={k.lore ?? k.note}
                      onClick={() => set({ skins: look.skins.map((v, w) => (w === weapon ? i : v)) })}
                    >
                      <SkinSwatch i={i} big gun={weapon} />
                      {k.group === "live" && <small className="lk-live">LIVE</small>}
                      <span>
                        {k.name}
                        <em>{k.note}</em>
                      </span>
                    </button>
                  ))}
              {curTab === "emote" &&
                EMOTES.map((e, i) => (
                  <button key={e.key} className={`lk-tile emote ${look.emote === i ? "on" : ""}`} onClick={() => play(i)}>
                    <EmoteGlyph k={e.key} />
                    <span>{e.name}</span>
                  </button>
                ))}
            </div>
          </div>
          {curTab === "skin" && (
            <button
              className="btn ghost lk-all"
              disabled={look.skins.every((v) => v === skinOf(look, weapon))}
              onClick={() => set({ skins: look.skins.map(() => skinOf(look, weapon)) })}
            >
              PUT {SKINS[skinOf(look, weapon)].name.toUpperCase()} ON EVERY GUN
            </button>
          )}
          <ServiceRecord />
          <button className="btn primary cs-done" onClick={() => go("/")}>
            DONE · BACK TO MENU
          </button>
        </section>
      </main>
    </div>
  );
}

/** Every night you finished on this device: the numbers, your deadliest gun and your last placings. */
function ServiceRecord() {
  const [c] = useState(loadCareer);
  const fav = favouriteGun(c);
  if (c.nights === 0)
    return (
      <div className="sr sr-empty">
        <label className="cs-label">SERVICE RECORD</label>
        <p>Finish a night and it starts here: your kills, wins, best placing and the gun that does your work.</p>
      </div>
    );
  const kd = c.deaths ? (c.kills / c.deaths).toFixed(2) : c.kills.toFixed(0);
  const stats: [string, string][] = [
    ["NIGHTS", String(c.nights)],
    ["WINS", String(c.wins)],
    ["KILLS", String(c.kills)],
    ["K / D", kd],
    ["BEST", c.best ? `#${c.best}` : "—"],
    ["IN THE DARK", fmtTime(c.alive)],
  ];
  return (
    <div className="sr">
      <div className="sr-head">
        <label className="cs-label">SERVICE RECORD</label>
        <span className="sr-rate">{Math.round((c.wins / c.nights) * 100)}% walked out</span>
      </div>
      <div className="sr-grid">
        {stats.map(([k, v]) => (
          <div key={k}>
            <b>{v}</b>
            <span>{k}</span>
          </div>
        ))}
      </div>
      {fav !== null && (
        <div className="sr-fav">
          <img src={`/models/guns/thumbs/${fav}.webp`} alt="" />
          <div>
            <span>DEADLIEST</span>
            <b>{WEAPON_NAME[fav]}</b>
          </div>
          <em>{c.guns[fav]} {c.guns[fav] === 1 ? "kill" : "kills"}</em>
        </div>
      )}
      {c.recent.length > 0 && (
        <div className="sr-recent" title="your last nights, newest first">
          {c.recent.map((p, i) => (
            <i key={i} className={p === 1 ? "won" : p > 0 && p <= 3 ? "top" : ""}>{p ? `#${p}` : "—"}</i>
          ))}
        </div>
      )}
    </div>
  );
}

