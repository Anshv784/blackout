// What your soldier looks like: character, outfit tone, gun finish, signature emote.
// Saved in this browser, and carried to everyone else in the spare bytes of your seat's name
// (names are at most 12 characters; bytes 13-15 of the 16 hold the look). No program change.
import { create } from "zustand";

export interface CharacterDef {
  id: number;
  key: string;
  name: string;
  role: string;
  url: string;
  /** the original Vanguard model gets the woodland camo repaint */
  camo?: boolean;
  /** not offered on the Operator page (its rig can't play the shared emotes) */
  hidden?: boolean;
}
export const CHARACTERS: CharacterDef[] = [
  { id: 0, key: "vanguard", name: "VANGUARD", role: "the original · field kit", url: "/models/soldier-v2.glb", camo: true, hidden: true },
  { id: 1, key: "heraklios", name: "TITAN", role: "heavy armour · officer", url: "/models/chars/heraklios.glb" },
  { id: 2, key: "ganfaul", name: "GRIM", role: "scarred · relentless", url: "/models/chars/ganfaul.glb" },
  { id: 3, key: "arissa", name: "VIPER", role: "scout · light on her feet", url: "/models/chars/arissa.glb" },
  { id: 4, key: "maria", name: "ECHO", role: "ranger · patient", url: "/models/chars/maria.glb" },
  { id: 5, key: "vampire", name: "NOX", role: "night stalker", url: "/models/chars/vampire.glb" },
  { id: 6, key: "medea", name: "VEIL", role: "duelist · cold-blooded", url: "/models/chars/medea.glb" },
];
export const ANIMS_URL = "/models/chars/anims.glb";

/** outfit tones: multiplied over the character's own colours (0 keeps them as made) */
export const OUTFITS: { name: string; tint: string }[] = [
  { name: "Original", tint: "#ffffff" },
  { name: "Woodland", tint: "#9fb07a" },
  { name: "Desert", tint: "#d8bf8e" },
  { name: "Urban", tint: "#a4abb6" },
  { name: "Midnight", tint: "#5f6a8a" },
  { name: "Arctic", tint: "#e8eef5" },
  { name: "Crimson", tint: "#c27a74" },
];
/** gun finishes: the colour the gun's metal and polymer are tinted */
export const FINISHES: { name: string; tint: string }[] = [
  { name: "Gunmetal", tint: "#ffffff" },
  { name: "Tan", tint: "#d9c39b" },
  { name: "Olive", tint: "#9aa678" },
  { name: "Arctic", tint: "#e9eef4" },
  { name: "Gold", tint: "#f2cf6a" },
  { name: "Crimson", tint: "#d0766d" },
];
/** gun skins: drawn live on the gun by a shader (scene/skins.ts); the finish tints them.
 *  At most 16 (a skin travels to the table in 4 bits). The first seven keep their old numbers. */
export const SKINS: { key: string; name: string; note: string; live?: boolean }[] = [
  { key: "plain", name: "Factory", note: "as it left the line" },
  { key: "woodland", name: "Woodland", note: "four-colour forest" },
  { key: "digital", name: "Digital", note: "urban pixels" },
  { key: "tiger", name: "Tiger", note: "burnt orange stripes" },
  { key: "carbon", name: "Carbon", note: "woven fibre, gloss" },
  { key: "hex", name: "Hex Grid", note: "a pulse runs the cells", live: true },
  { key: "ember", name: "Ember", note: "charred, still burning", live: true },
  { key: "damascus", name: "Damascus", note: "folded steel, light sweep", live: true },
  { key: "circuit", name: "Circuit", note: "signals race the traces", live: true },
  { key: "molten", name: "Molten", note: "lava that never cools", live: true },
  { key: "aurora", name: "Aurora", note: "northern lights drift", live: true },
  { key: "void", name: "Void", note: "nebula and starlight", live: true },
  { key: "glitch", name: "Glitch", note: "corrupted, flickering", live: true },
  { key: "frost", name: "Frost", note: "ice crystals that glint", live: true },
  { key: "prism", name: "Prism", note: "shifts colour as it turns", live: true },
  { key: "toxic", name: "Toxic", note: "it bubbles", live: true },
];
export const EMOTES: { key: string; name: string; clip: string }[] = [
  { key: "salute", name: "Salute", clip: "emote_salute" },
  { key: "victory", name: "Victory", clip: "emote_victory" },
  { key: "wave", name: "Wave", clip: "emote_wave" },
  { key: "taunt", name: "Taunt", clip: "emote_taunt" },
  { key: "dance", name: "Dance", clip: "emote_dance" },
  { key: "clap", name: "Clap", clip: "emote_clap" },
];

export interface Look {
  char: number;
  outfit: number;
  finish: number;
  emote: number;
  /** one skin per gun, indexed by weapon (0 = pistol … 7 = crossbow) */
  skins: number[];
}
export const DEFAULT_LOOK: Look = { char: 1, outfit: 0, finish: 0, emote: 3, skins: Array(8).fill(0) }; // taunt by default
/** the skin on this gun */
export const skinOf = (l: Look, weapon: number) => l.skins?.[weapon] ?? 0;
/** the operators you can pick */
export const ROSTER = CHARACTERS.filter((c) => !c.hidden);

const MAGIC = 0xb0; // v1: one skin for every gun
const clampSkin = (v: unknown) => Math.min(SKINS.length - 1, Math.max(0, Math.floor(Number(v) || 0)));
const clampLook = (l: Partial<Look> & { skin?: number }): Look => ({
  // a retired operator (the original) becomes TITAN
  char: CHARACTERS[l.char ?? 1] && !CHARACTERS[l.char ?? 1].hidden ? (l.char ?? 1) : 1,
  outfit: Math.min(OUTFITS.length - 1, Math.max(0, l.outfit ?? 0)),
  finish: Math.min(FINISHES.length - 1, Math.max(0, l.finish ?? 0)),
  emote: Math.min(EMOTES.length - 1, Math.max(0, l.emote ?? DEFAULT_LOOK.emote)),
  // an old save had one `skin` for every gun
  skins: Array.from({ length: 8 }, (_, w) => clampSkin(Array.isArray(l.skins) ? l.skins[w] : l.skin)),
});

/** The one skin the table sees on your long guns (there are only 4 bits for it): the skin on the
 *  gun you carry on the home screen, else the one you put on the most long guns. */
export function mainSkin(l: Look, preview = previewGun()): number {
  if (preview > 0 && l.skins[preview]) return l.skins[preview];
  const n = new Map<number, number>();
  for (let w = 1; w < 8; w++) if (l.skins[w]) n.set(l.skins[w], (n.get(l.skins[w]) ?? 0) + 1);
  let best = 0, most = 0;
  for (const [k, c] of n) if (c > most) [best, most] = [k, c];
  return best;
}

/** Write the look into bytes 13-15 of a 16-byte name (the name itself is at most 12, byte 12 is 0).
 *  v2: b13 = 11 · char(3) · outfit(3), b14 = finish(3) · emote(3) · 00, b15 = pistol skin · long-gun skin.
 *  v1 (older clients) had 1011 in b13's high nibble, so the two never collide. */
export function encodeLook(name16: Uint8Array, l: Look) {
  name16[12] = 0;
  name16[13] = 0xc0 | ((l.char & 7) << 3) | (l.outfit & 7);
  name16[14] = ((l.finish & 7) << 5) | ((l.emote & 7) << 2);
  name16[15] = ((l.skins[0] & 0xf) << 4) | (mainSkin(l) & 0xf);
}
/** a seat with no look chosen (bots, older clients): a different operator per seat */
export const seatDefault = (seat: number): Look => ({ ...DEFAULT_LOOK, char: ROSTER[seat % ROSTER.length].id, outfit: seat % 3 === 2 ? 1 : 0 });
export function decodeLook(name16: Uint8Array, seat = 0): Look {
  const b13 = name16[13], b14 = name16[14], b15 = name16[15];
  if ((b13 & 0xc0) === 0xc0) {
    const long = b15 & 0xf;
    return clampLook({ char: (b13 >> 3) & 7, outfit: b13 & 7, finish: b14 >> 5, emote: (b14 >> 2) & 7, skins: [b15 >> 4, long, long, long, long, long, long, long] });
  }
  if ((b13 & 0xf0) !== MAGIC) return seatDefault(seat);
  return clampLook({ char: b14 & 0xf, outfit: b14 >> 4, finish: b15 & 0xf, emote: b15 >> 4, skin: b13 & 0xf });
}

const load = (): Look => {
  try {
    return clampLook(JSON.parse(localStorage.getItem("bo-look") ?? "{}"));
  } catch {
    return DEFAULT_LOOK;
  }
};
export const useLook = create<{ look: Look; set: (l: Partial<Look>) => void }>((set, get) => ({
  look: load(),
  set: (l) => {
    const look = clampLook({ ...get().look, ...l });
    try {
      localStorage.setItem("bo-look", JSON.stringify(look));
    } catch {
      /* private mode: the look just isn't remembered */
    }
    set({ look });
  },
}));
export const getLook = () => useLook.getState().look;

/** the gun last picked on the Operator page (shown on the home screen), the KESTREL by default */
export function previewGun(): number {
  try {
    const v = Number(localStorage.getItem("bo-preview-gun"));
    return Number.isInteger(v) && v >= 0 && v <= 7 && localStorage.getItem("bo-preview-gun") !== null ? v : 3;
  } catch {
    return 3;
  }
}
