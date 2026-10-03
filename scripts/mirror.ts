import fs from "fs";
import { inputVelocity, moveBody } from "../app/src/game/sim.ts";
import { SPAWNS } from "../app/src/game/gen.ts";
let s = 12345;
const next = () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s; };
let out = "";
for (const [sx, sy] of SPAWNS.slice(0, 5)) {
  const p = { x: sx * 256 + 128, y: sy * 256 + 128 };
  for (let i = 0; i < 400; i++) {
    const dx = ((next() >>> 16) % 255) - 127;
    const dy = ((next() >>> 16) % 255) - 127;
    const [vx, vy] = inputVelocity(dx, dy);
    moveBody(p, vx, vy);
    out += `${p.x},${p.y};`;
  }
}
const rust = fs.readFileSync("/tmp/blackout-mirror-rust.txt", "utf8");
console.log(rust === out ? `MATCH: ${out.split(";").length - 1} steps identical` : `MISMATCH at char ${[...out].findIndex((c, i) => c !== rust[i])}`);
