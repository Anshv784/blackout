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
/** emotes recorded after the main pack, each its own small file (merged into the pack's clips) */
export const EXTRA_ANIMS_URL = "/models/chars/emote_thumbs.glb";

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
 *  At most 32 (a skin travels to the table in 5 bits). Numbers never change once shipped. */
export type SkinGroup = "classic" | "live" | "legend";
export const SKINS: { key: string; name: string; note: string; group: SkinGroup; live?: boolean; lore?: string }[] = [
  { key: "plain", name: "Factory", note: "as it left the line", group: "classic" },
  { key: "woodland", name: "Woodland", note: "four-colour forest", group: "classic" },
  { key: "digital", name: "Digital", note: "urban pixels", group: "classic" },
  { key: "tiger", name: "Tiger", note: "burnt orange stripes", group: "classic" },
  { key: "carbon", name: "Carbon", note: "woven fibre, gloss", group: "classic" },
  { key: "hex", name: "Hex Grid", note: "a pulse runs the cells", group: "live", live: true },
  { key: "ember", name: "Ember", note: "charred, still burning", group: "live", live: true },
  { key: "damascus", name: "Damascus", note: "folded steel, light sweep", group: "live", live: true },
  { key: "circuit", name: "Circuit", note: "signals race the traces", group: "live", live: true },
  { key: "molten", name: "Molten", note: "lava that never cools", group: "live", live: true },
  { key: "aurora", name: "Aurora", note: "northern lights drift", group: "live", live: true },
  { key: "void", name: "Void", note: "nebula and starlight", group: "live", live: true },
  { key: "glitch", name: "Glitch", note: "corrupted, flickering", group: "live", live: true },
  { key: "frost", name: "Frost", note: "ice crystals that glint", group: "live", live: true },
  { key: "prism", name: "Prism", note: "shifts colour as it turns", group: "live", live: true },
  { key: "toxic", name: "Toxic", note: "it bubbles", group: "live", live: true },
  {
    key: "monarch", name: "Monarch", note: "butterflies in migration", group: "legend", live: true,
    lore: "Monarchs fly thousands of miles to a forest none of them has ever seen, and still find it. Wear it for the long way home through the dark.",
  },
  {
    key: "dragon", name: "Dragon", note: "fire runs the scales", group: "legend", live: true,
    lore: "A dragon sleeps on a hoard it never spends. Tonight the pot is the hoard, and the one who guards it best goes home with it.",
  },
  {
    key: "koi", name: "Koi", note: "laps of a lit pond", group: "legend", live: true,
    lore: "The koi that swims up the waterfall becomes a dragon. Every night you keep swimming against it.",
  },
  {
    key: "phoenix", name: "Phoenix", note: "burns out, comes back", group: "legend", live: true,
    lore: "Down is not dead. It burns to ash, waits, and catches again from the grip outward. For the ones who get picked back up.",
  },
  {
    key: "sakura", name: "Sakura", note: "blossoms falling", group: "legend", live: true,
    lore: "The cherry blossom lasts a week and nobody forgets it. A night lasts five minutes. Make it the one they remember.",
  },
  {
    key: "storm", name: "Storm", note: "lightning in the clouds", group: "legend", live: true,
    lore: "You see the flash before you hear the thunder, and by then it has already struck. Built for the shot nobody hears coming.",
  },
  {
    key: "heartbeat", name: "Last Breath", note: "a monitor that flatlines", group: "legend", live: true,
    lore: "Seven heartbeats go flat every night. Every fourth pass the line goes quiet too, to remind you whose is still going.",
  },
  {
    key: "moon", name: "Hunter's Moon", note: "waxes, wanes, clouds cross", group: "legend", live: true,
    lore: "The one night the moon gives everyone away. Wear it anyway: whoever hunts under it is not hiding.",
  },
  {
    key: "constellation", name: "Constellation", note: "stars joined into figures", group: "legend", live: true,
    lore: "Sailors found home by joining dots in the dark. The lines draw themselves, hold, and let go, like the people you meet in a night.",
  },
  {
    key: "abyss", name: "Abyss", note: "jellyfish of the deep", group: "legend", live: true,
    lore: "Down where no sun reaches, everything makes its own light. Nobody brings a torch to the bottom of the sea.",
  },
  {
    key: "wisp", name: "Wisp", note: "spirit lights wander", group: "legend", live: true,
    lore: "Marsh lights lead travellers off the path. Follow one and you will find someone. Maybe not who you wanted.",
  },
  {
    key: "clockwork", name: "Clockwork", note: "gears that tick", group: "legend", live: true,
    lore: "The night runs on a twenty-tick heart inside a sealed machine. You only ever need to be one tick faster.",
  },
];
export const EMOTES: { key: string; name: string; clip: string }[] = [
  { key: "salute", name: "Salute", clip: "emote_salute" },
  { key: "victory", name: "Victory", clip: "emote_victory" },
  { key: "wave", name: "Wave", clip: "emote_wave" },
  { key: "taunt", name: "Taunt", clip: "emote_taunt" },
  { key: "dance", name: "Dance", clip: "emote_dance" },
  { key: "thumbs", name: "Thumbs Up", clip: "emote_thumbs" }, // replaced Clap (same slot: a saved Clap becomes Thumbs Up)
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
 *  v2: b13 = 11 · char(3) · outfit(3), b14 = finish(3) · emote(3) · pistol skin bit 4 · long skin bit 4,
 *  b15 = pistol skin low 4 · long-gun skin low 4. (Skins 0-15 encode exactly as before.)
 *  v1 (older clients) had 1011 in b13's high nibble, so the two never collide. */
export function encodeLook(name16: Uint8Array, l: Look) {
  const pistol = l.skins[0] & 0x1f;
  const long = mainSkin(l) & 0x1f;
  name16[12] = 0;
  name16[13] = 0xc0 | ((l.char & 7) << 3) | (l.outfit & 7);
  name16[14] = ((l.finish & 7) << 5) | ((l.emote & 7) << 2) | ((pistol >> 4) << 1) | (long >> 4);
  name16[15] = ((pistol & 0xf) << 4) | (long & 0xf);
}
/** The three packed look bytes (13-15 of the name), as sent by `set_look`. */
export function lookBytes(l: Look): number[] {
  const b = new Uint8Array(16);
  encodeLook(b, l);
  return [b[13], b[14], b[15]];
}
/** a seat with no look chosen (bots, older clients): a different operator per seat */
export const seatDefault = (seat: number): Look => ({ ...DEFAULT_LOOK, char: ROSTER[seat % ROSTER.length].id, outfit: seat % 3 === 2 ? 1 : 0 });
export function decodeLook(name16: Uint8Array, seat = 0): Look {
  const b13 = name16[13], b14 = name16[14], b15 = name16[15];
  if ((b13 & 0xc0) === 0xc0) {
    const pistol = (b15 >> 4) | (((b14 >> 1) & 1) << 4);
    const long = (b15 & 0xf) | ((b14 & 1) << 4);
    return clampLook({ char: (b13 >> 3) & 7, outfit: b13 & 7, finish: b14 >> 5, emote: (b14 >> 2) & 7, skins: [pistol, long, long, long, long, long, long, long] });
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
