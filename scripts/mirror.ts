import fs from "fs";
import { inputVelocity, moveBody, moveStep, BTN_SPRINT, BTN_CROUCH, BTN_JUMP } from "../app/src/game/sim.ts";
import { SPAWNS } from "../app/src/game/gen.ts";
let s = 12345;
const next = () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s; };
let out = "";
for (const [sx, sy] of SPAWNS.slice(0, 5)) {
  const p = { x: sx * 256 + 128, y: sy * 256 + 128 };
  let moved = 0;
  for (let i = 0; i < 400; i++) {
    const dx = ((next() >>> 16) % 255) - 127;
    const dy = ((next() >>> 16) % 255) - 127;
    const buttons = ((s >>> 9) % 7 < 3 ? BTN_SPRINT | ((s >>> 12) & 1) : 0) | ((s >>> 14) % 9 === 0 ? BTN_CROUCH : 0) | ((s >>> 17) % 11 === 0 ? BTN_JUMP : 0);
    const [speed, sprinting, word] = moveStep(moved, buttons, dx, dy, false);
    const [vx, vy] = inputVelocity(dx, dy, speed);
    const ox = p.x, oy = p.y;
    moveBody(p, vx, vy);
    const m = ox !== p.x || oy !== p.y;
    moved = (m ? 1 : 0) | (sprinting && m ? word : word & ~2);
    out += `${p.x},${p.y},${moved >>> 8};`;
  }
}
const rust = fs.readFileSync("/tmp/blackout-mirror-rust.txt", "utf8");
console.log(rust === out ? `MATCH: ${out.split(";").length - 1} steps identical` : `MISMATCH at char ${[...out].findIndex((c, i) => c !== rust[i])}`);
