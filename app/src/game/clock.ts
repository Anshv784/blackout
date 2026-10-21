// The fallback game clock. MagicBlock's crank ticks the night at 20 Hz; when it stops, a player's
// browser has to push ticks instead. It must stay out of the way while the crank works: extra tick
// transactions queue up in the rollup behind inputs and the crank's own ticks, and a browser that
// fires one every 50 ms at the first hiccup can stall the whole night (measured: 14 ticks/s → 0).
//
// So: step in only after a real stall and keep only a few ticks in flight. Every few seconds,
// throttle down to one in flight for a moment: if ticks still arrive faster than that alone can
// make them, the crank is back, so hand time back to it. (No full pause: that froze the night.)

/** how long the night must be frozen before the driving browser takes over (ms) */
export const STALL_DRIVER = 1500;
/** the other players wait longer, so only one browser drives */
export const STALL_OTHERS = 3500;
const MIN_GAP = 50;
const PROBE_EVERY = 8000;
const PROBE_FOR = 1500;
/** ticks/s during a probe above which the crank must be helping (one in flight alone makes ~7) */
const PROBE_ALIVE_TPS = 14;

export class ClockKeeper {
  driving = false;
  sent = 0;
  private inFlight = 0;
  private lastSend = 0;
  private drivingSince = 0;
  private probeUntil = 0;
  private probeTick = 0;

  constructor(
    private send: () => Promise<unknown>,
    private maxInFlight = 2,
  ) {}

  /** Call every ~50 ms while a night is running. `quiet` = ms since the room's tick last moved. */
  step(now: number, quiet: number, tick: number, isDriver: boolean) {
    if (!this.driving) {
      if (quiet < (isDriver ? STALL_DRIVER : STALL_OTHERS)) return;
      this.driving = true;
      this.drivingSince = now;
    }
    let cap = this.maxInFlight;
    if (this.probeUntil) {
      if (now >= this.probeUntil) {
        this.probeUntil = 0;
        this.drivingSince = now;
        if (((tick - this.probeTick) * 1000) / PROBE_FOR >= PROBE_ALIVE_TPS) {
          this.driving = false; // the crank is keeping time again
          return;
        }
      } else cap = 1;
    } else if (now - this.drivingSince > PROBE_EVERY) {
      this.probeUntil = now + PROBE_FOR;
      this.probeTick = tick;
      cap = 1;
    }
    if (this.inFlight >= cap || now - this.lastSend < MIN_GAP) return;
    this.lastSend = now;
    this.inFlight++;
    this.sent++;
    // a send that never settles must not block the clock forever
    let done = false;
    const release = () => {
      if (done) return;
      done = true;
      this.inFlight--;
    };
    setTimeout(release, 3000);
    this.send()
      .catch(() => {})
      .finally(release);
  }

  reset() {
    this.driving = false;
    this.probeUntil = 0;
  }
}
