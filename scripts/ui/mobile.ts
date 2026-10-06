// Phone pass: landscape iPhone-size viewport with touch. Screens the gate, lobby, countdown
// and live HUD, then walks with the stick, looks, jumps and aims a throw.
import { chromium } from "playwright";
(async () => {
  const b = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
  const ctx = await b.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  await ctx.addInitScript("localStorage.setItem('bo-intro-seen','1');localStorage.setItem('bo-guest','1');localStorage.setItem('bo-name','PHONE')");
  const p = await ctx.newPage();
  const errs: string[] = [];
  p.on("pageerror", (e) => errs.push(String(e)));
  await p.goto("http://127.0.0.1:5173/");
  await p.waitForTimeout(4000);
  await p.screenshot({ path: "demo/m-gate.png" });
  await p.getByRole("button", { name: /CREATE A ROOM/ }).tap({ timeout: 30000 });
  await p.waitForURL(/\/r\//, { timeout: 60000 });
  await p.waitForTimeout(2500);
  await p.screenshot({ path: "demo/m-lobby.png" });
  await p.getByRole("button", { name: "START THE NIGHT" }).tap({ timeout: 60000 });
  await p.locator(".night-card").waitFor({ timeout: 90000 });
  await p.screenshot({ path: "demo/m-countdown.png" });
  await p.locator(".compass").waitFor({ timeout: 90000 });
  await p.waitForTimeout(3000);
  await p.screenshot({ path: "demo/m-live.png" });
  // touches are synthesised on the element so several fingers can be down at once
  const touch = (sel: string, type: string, x: number, y: number, id: number) =>
    p.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); const t = new Touch({ identifier: ${id}, target: el, clientX: ${x}, clientY: ${y} });
      el.dispatchEvent(new TouchEvent(${JSON.stringify(type)}, { touches: ${type === "touchend" ? "[]" : "[t]"}, changedTouches: [t], bubbles: true, cancelable: true })); })()`);
  const pos = () => p.evaluate(`(() => { const s = window.__session; const q = s && s.myPos(); return q ? [Math.round(q.x), Math.round(q.y)] : null; })()`);
  const before = await pos();
  await touch(".stick-zone", "touchstart", 110, 300, 1);
  await touch(".stick-zone", "touchmove", 110, 250, 1);
  await p.waitForTimeout(2500);
  await p.screenshot({ path: "demo/m-walk.png" });
  await touch(".stick-zone", "touchend", 110, 250, 1);
  const after = await pos();
  console.log("walk", before, "->", after);
  await touch(".look-pad", "touchstart", 600, 200, 2);
  for (let i = 1; i <= 10; i++) await touch(".look-pad", "touchmove", 600 + i * 12, 200, 2);
  await touch(".look-pad", "touchend", 720, 200, 2);
  console.log("yaw", await p.evaluate("window.__controls.camYaw"));
  // pretend we hold two frags (client-side only) so the arc draws
  await p.evaluate("setInterval(() => { const v = window.__session.view; if (v) { v.inv.gadget = 1; v.inv.count = 2; } }, 5)");
  await p.waitForTimeout(400);
  await touch(".tb.gadget", "touchstart", 640, 230, 3);
  await p.waitForTimeout(1200);
  await p.screenshot({ path: "demo/m-aimthrow.png" });
  await touch(".tb.gadget", "touchend", 640, 230, 3);
  await p.waitForTimeout(600);
  await p.screenshot({ path: "demo/m-thrown.png" });
  console.log("errors", errs);
  await b.close();
})();
