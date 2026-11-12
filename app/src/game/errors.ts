// Turn any failure (a program error, a wallet refusal, a network hiccup) into a sentence a player
// understands: why it didn't work, and what to do. Raw transaction text never reaches the screen.
import idl from "../idl/blackout.json";

/** program error name → what the player is told */
const PLAIN: Record<string, string> = {
  NotInLobby: "A night is already running in this room. Wait for it to end, or pick another room.",
  WrongCode: "That room code is wrong. Check it with the person who invited you.",
  AlreadySeated: "You already have a seat in this room.",
  SeatTaken: "That seat was just taken. Try again and you'll get another one.",
  RoomFull: "This room is full. Try another room.",
  RoomTaken: "Someone opened this room a moment before you. Try again and you'll get another one.",
  NoHost: "Nobody is hosting this room any more. Create your own room instead.",
  NeedTicket: "You need a valid ticket for this staked table. Yours may have expired: sit down again to buy a new one.",
  NotReady: "This room can't do that right now. Try another room.",
  NotSeated: "You're not seated in this room any more. Take a seat again.",
  NotHost: "Only the room's host can do that.",
  NotEnoughPlayers: "You need at least 2 players to start.",
  TooEarly: "Not yet. A staked table starts on its own when its countdown ends.",
  NotStarting: "The night already got its start. Give it a second.",
  NotEnded: "The night isn't over yet.",
  DailyNotReady: "Today's challenge isn't ready yet. Try again in a few seconds.",
  DailyPlayed: "This wallet already played today's challenge. A new one opens at midnight UTC.",
  TicketLocked: "That stake can't be refunded yet. It unlocks 1 hour after the ticket was bought.",
  NotStaked: "This isn't a staked table.",
  BadSeat: "Something about that seat changed. Refresh the page and try again.",
  BadAccount: "Something went wrong with this room. Refresh the page and try again.",
  NotAdmin: "Only the game's admin can do that.",
  StakesOutstanding: "This room still holds players' tickets.",
};

const byCode = new Map<number, string>(((idl as any).errors ?? []).map((e: { code: number; name: string }) => [e.code, e.name]));

/** The program error behind a failure, if there is one. */
function programError(text: string): string | null {
  const named = text.match(/Error Code: (\w+)/);
  if (named) return named[1];
  const custom = text.match(/"Custom":\s*(\d+)/) ?? text.match(/custom program error: 0x([0-9a-f]+)/i);
  if (custom) {
    const n = custom[0].includes("0x") ? parseInt(custom[1], 16) : Number(custom[1]);
    return byCode.get(n) ?? null;
  }
  return null;
}

export function friendlyError(e: unknown): string {
  const text = String((e as any)?.message ?? e ?? "");
  const name = programError(text);
  if (name) return PLAIN[name] ?? "Something went wrong with that action. Try again.";
  if (/user rejected|rejected the request|declined|denied|cancel/i.test(text)) return "You cancelled it in your wallet. Nothing was sent.";
  if (/insufficient (funds|lamports)|not enough sol|0x1\b|Attempt to debit an account but found no record of a prior credit/i.test(text))
    return "Not enough SOL in your wallet for this. Top it up and try again.";
  if (/429|too many requests|rate limit/i.test(text)) return "The network is busy right now. Wait a few seconds and try again.";
  if (/failed to fetch|networkerror|fetch failed|timed? ?out|not confirmed|blockhash|socket|ECONN|offline/i.test(text))
    return "Couldn't reach the network. Check your connection and try again.";
  // a message the game already wrote for people: show it as it is
  const technical = /tx failed|InstructionError|Program log|0x[0-9a-f]{2,}|[{}[\]]/i.test(text);
  if (text && !technical) return text.replace(/\s*\([^)]*\)\s*$/, "").slice(0, 160);
  return "Something went wrong. Try again in a moment.";
}
