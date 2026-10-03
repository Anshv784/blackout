// In-browser session key: your in-game identity. Never holds funds — the Private ER
// is gasless, so a fresh keypair can play immediately. Your wallet (optional) is only
// used as the payout / leaderboard address.
import { Keypair } from "@solana/web3.js";
import { BlackoutClient, type TokenStore } from "../chain/client";

const KEY = "bo-session-key-v1";
const NAME = "bo-name";

export const storage: TokenStore = {
  get(k) {
    try {
      return window.localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      window.localStorage.setItem(k, v);
    } catch {
      /* private mode */
    }
  },
};

function loadKeypair(): Keypair {
  const raw = storage.get(KEY);
  if (raw) {
    try {
      return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
    } catch {
      /* fall through */
    }
  }
  const kp = Keypair.generate();
  storage.set(KEY, JSON.stringify(Array.from(kp.secretKey)));
  return kp;
}

const ADJ = ["SILENT", "HOLLOW", "NIGHT", "STATIC", "LOW", "COLD", "PALE", "DARK", "QUIET", "BLIND"];
const NOUN = ["FOX", "MOTH", "OWL", "LYNX", "CROW", "VIPER", "WOLF", "HARE", "RAVEN", "BAT"];

export function loadName(): string {
  const n = storage.get(NAME);
  if (n) return n;
  const gen = `${ADJ[Math.floor(Math.random() * ADJ.length)]}${NOUN[Math.floor(Math.random() * NOUN.length)]}`.slice(0, 12);
  storage.set(NAME, gen);
  return gen;
}

export function saveName(n: string) {
  storage.set(NAME, n.toUpperCase().replace(/[^A-Z0-9_\-]/g, "").slice(0, 12));
}

export const sessionKey = loadKeypair();
export const client = new BlackoutClient(sessionKey, storage);
