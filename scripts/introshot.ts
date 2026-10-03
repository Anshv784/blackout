import { chromium } from "playwright";
const out = process.argv[2];
const b = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs: string[] = [];
p.on("pageerror", (e) => errs.push(e.message));
await p.goto("http://127.0.0.1:5173/"); await p.waitForTimeout(1500);
await p.click("text=ENTER");
const shots = [2, 8, 13, 15.5, 19, 23, 30, 35];
let last = 0;
for (const s of shots) {
  // the scene clock runs on rendered frames; wait by the in-scene timer
  await p.waitForFunction((target) => { const el = document.querySelector(".intro-progress i") as HTMLElement | null; return !!el && parseFloat(el.style.width) >= (target / 38) * 100; }, s, { timeout: 240000 });
  await p.screenshot({ path: `${out}/c-${String(s).padStart(4, "0")}.png` });
  last = s;
}
console.log("errors", errs, "last", last);
await b.close();
