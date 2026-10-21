// Local playtest: guest → room → night vs bots → move/shoot → measure → reveal. Usage: tsx playtest.ts <outdir> [mobile]
import { chromium, devices } from "playwright";
const out = process.argv[2] ?? "demo/qa";
const mobile = process.argv[3] === "mobile";
const URL = process.env.URL ?? "http://127.0.0.1:5173/";
const b = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const ctx = await b.newContext(mobile ? { ...devices["Pixel 7 landscape"] } : { viewport: { width: 1440, height: 900 } });
await ctx.addInitScript("localStorage.setItem('bo-intro-seen','1')");
const p = await ctx.newPage();
const errs: string[] = [];
const warns: string[] = [];
p.on("pageerror", (e) => errs.push(String(e).slice(0, 300)));
p.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text().slice(0, 300)); if (m.type() === "warning") warns.push(m.text().slice(0, 200)); });
const t0 = Date.now();
const log = (...a: unknown[]) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);
await p.goto(URL);
await p.getByRole("button", { name: /CREATE A ROOM/ }).click({ timeout: 40000 });
await p.getByRole("button", { name: "PLAY AS GUEST" }).click();
await p.getByRole("button", { name: "ENTER AS GUEST" }).click();
await p.waitForURL(/\/r\//, { timeout: 60000 }); log("room", p.url());
await p.waitForSelector("button:has-text('START THE NIGHT')", { timeout: 60000 });
await p.waitForTimeout(1500);
await p.screenshot({ path: `${out}/lobby.png` });
await p.click("button:has-text('START THE NIGHT')");
await p.waitForSelector(".game", { timeout: 90000 }); log("game");
// wait for LIVE
await p.waitForFunction(() => (window as any).__session?.room?.status === 3, null, { timeout: 60000 }).catch(() => log("never LIVE?"));
log("live");
await p.mouse.click(720, 450).catch(() => {});
const sample = () => p.evaluate(() => {
  const s = (window as any).__session;
  const st = (window as any).__store?.getState?.();
  return { tick: s?.room?.tick, snaps: s?.snaps, rtt: Math.round(s?.rtt), interp: Math.round(s?.interpDelay), gap: Math.round(s?.worstGap), tps: st?.stats?.tps, hp: s?.view?.me?.hp, alive: s?.view?.me?.alive, seen: s?.view?.players?.length, pos: s?.myPos?.() && [Math.round(s.myPos().x), Math.round(s.myPos().y)] };
});
// fps meter
await p.evaluate(`window.__fps = []; (function(){ var last = performance.now(), n = 0; function f(){ n++; var now = performance.now(); if (now - last >= 1000) { window.__fps.push(n); n = 0; last = now; } requestAnimationFrame(f); } requestAnimationFrame(f); })()`);
const keys = ["w", "d", "s", "a"];
for (let i = 0; i < 8; i++) {
  if (!mobile) {
    await p.keyboard.down(keys[i % 4]);
    await p.mouse.down(); await p.waitForTimeout(400); await p.mouse.up();
    await p.waitForTimeout(2000);
    await p.keyboard.up(keys[i % 4]);
  } else await p.waitForTimeout(2400);
  log(JSON.stringify(await sample()));
  if (i === 2) await p.screenshot({ path: `${out}/play.png` });
}
await p.screenshot({ path: `${out}/play2.png` });
log("fps", JSON.stringify(await p.evaluate(() => (window as any).__fps)));
// end the night as host via the menu if available
await p.waitForSelector(".reveal", { timeout: 240000 }).then(() => log("reveal")).catch(() => log("no reveal"));
await p.waitForTimeout(3000);
await p.screenshot({ path: `${out}/reveal.png` });
console.log("ERRORS", JSON.stringify(errs.slice(0, 15), null, 1));
console.log("WARNS", JSON.stringify([...new Set(warns)].slice(0, 10), null, 1));
await b.close();
