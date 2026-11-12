// A finished night's room reopens on its own ~45 s after the lights come on, while the replay
// stays on the screen of whoever is still watching it.
import { chromium } from "playwright";
(async () => {
  const b = await chromium.launch({ channel: "chrome", args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
  const ctx = await b.newContext({ viewport: { width: 1400, height: 860 } });
  await ctx.addInitScript("localStorage.setItem('bo-intro-seen','1');localStorage.setItem('bo-guest','1');localStorage.setItem('bo-name','WATCHR');localStorage.setItem('bo-prefs-v1', JSON.stringify({weather:false}))");
  const p = await ctx.newPage();
  const errs: string[] = [];
  p.on("pageerror", (e) => errs.push(String(e)));
  await p.goto("http://127.0.0.1:5173/");
  await p.getByRole("button", { name: /CREATE ROOM/ }).click({ timeout: 30000 });
  await p.waitForURL(/\/r\//, { timeout: 60000 });
  const id = p.url().match(/\/r\/(\d+)/)![1];
  await p.getByRole("button", { name: "START THE NIGHT" }).click({ timeout: 60000 });
  await p.locator(".compass").waitFor({ timeout: 90000 });
  console.log("room", id, "night running");
  const status = () => p.evaluate(() => (window as any).__store.getState().room?.status as number);
  // when did the lights come on (status 5 = revealed)?
  let litAt = 0;
  for (let i = 0; i < 300 && !litAt; i++) {
    await p.waitForTimeout(1000);
    if ((await status()) === 5) litAt = Date.now();
  }
  await p.locator(".vc-actions").waitFor({ timeout: 300000 });
  console.log(`replay card appeared ${((Date.now() - litAt) / 1000).toFixed(0)} s after the lights came on`);
  const t0 = litAt;
  console.log("replay on screen, room status", await status());
  const timer = await p.locator(".vc-timer").first().textContent({ timeout: 5000 }).catch(() => null);
  console.log(timer ? `PASS countdown visible: ${timer}` : "FAIL no countdown on the replay");
  await p.screenshot({ path: (process.argv[2] ?? "/tmp/reopen.png").replace(".png", "-timer.png") });
  let reopenedAt = 0;
  while (Date.now() - t0 < 90000) {
    await p.waitForTimeout(2000);
    const d = await p.evaluate(async () => {
      const st = (window as any).__store.getState();
      const r = st.room;
      return { s: r?.status, seat: st.mySeat, seen: r?.lastSeen?.[st.mySeat ?? 0] };
    });
    if (process.env.TRACE) console.log(`  +${((Date.now() - t0) / 1000).toFixed(0)}s`, JSON.stringify(d));
    if (d.s === 0) { reopenedAt = Date.now(); break; }
  }
  console.log(reopenedAt ? `PASS room reopened ${((reopenedAt - t0) / 1000).toFixed(0)} s after the lights came on` : "FAIL room never reopened");
  await p.waitForTimeout(1500);
  const still = await p.locator(".vc-actions").isVisible();
  const note = await p.locator(".vc-reopened").isVisible();
  console.log(still && note ? "PASS replay still on screen, with the reopened note" : `FAIL replay visible ${still}, note ${note}`);
  await p.screenshot({ path: process.argv[2] ?? "/tmp/reopen.png" });
  await p.getByRole("button", { name: "PLAY AGAIN" }).first().click();
  const lobby = await p.getByRole("button", { name: "START THE NIGHT" }).waitFor({ timeout: 20000 }).then(() => true, () => false);
  console.log(lobby ? "PASS PLAY AGAIN goes to the reopened lobby" : "FAIL no lobby after PLAY AGAIN");
  console.log("errors", errs);
  await p.goto("http://127.0.0.1:5173/"); // leaving a lobby frees the seat
  await p.waitForTimeout(3000);
  await b.close();
})();
