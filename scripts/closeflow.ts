import { chromium } from "playwright";
(async () => {
  const b = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
  const ctx = await b.newContext({ viewport: { width: 1400, height: 860 } });
  const p = await ctx.newPage();
  const errs: string[] = [];
  p.on("pageerror", (e) => errs.push(String(e)));
  await ctx.addInitScript("localStorage.setItem('bo-intro-seen','1');localStorage.setItem('bo-guest','1');localStorage.setItem('bo-name','TESTER')");
  await p.goto("http://127.0.0.1:5173/");
  await p.getByRole("button", { name: /CREATE A ROOM/ }).click({ timeout: 30000 });
  await p.waitForURL(/\/r\//, { timeout: 60000 });
  const id = p.url().match(/\/r\/(\d+)/)![1];
  await p.getByRole("button", { name: "START THE NIGHT" }).waitFor({ timeout: 60000 });
  await p.locator(".bot-level button", { hasText: "EASY" }).click();
  await p.locator(".bot-level button.on", { hasText: "EASY" }).waitFor({ timeout: 20000 });
  await p.screenshot({ path: "demo/bots-easy.png" });
  console.log("room", id, "bots set to EASY");

  // one room at a time: a second tab (same player) tries to open another room
  const p2 = await ctx.newPage();
  await p2.goto("http://127.0.0.1:5173/#/");
  await p2.waitForTimeout(6000);
  await p2.getByRole("button", { name: /PRIVATE ROOM FOR FRIENDS/ }).click();
  await p2.getByText("ONE ROOM AT A TIME", { exact: true }).waitFor({ timeout: 10000 });
  await p2.screenshot({ path: "demo/one-room.png" });
  console.log("guard shown on home");
  const other = 5; // the staked table: a lobby you're not in
  await p2.goto(`http://127.0.0.1:5173/#/r/${other}`);
  await p2.waitForTimeout(12000);
  await p2.screenshot({ path: "demo/one-room-lobby.png" });
  await p2.getByText("ONE ROOM AT A TIME", { exact: true }).waitFor({ timeout: 5000 });
  console.log("guard shown in room", other);
  await p2.close();

  await p.getByRole("button", { name: "START THE NIGHT" }).click({ timeout: 60000 });
  await p.locator(".reveal-top, .verdict, .vc-actions").first().waitFor({ timeout: 240000 });
  await p.waitForTimeout(3000);
  await p.screenshot({ path: "demo/reveal-close.png" });
  await p.locator(".reveal-actions").getByRole("button", { name: "CLOSE ROOM" }).click({ force: true });
  await p.locator(".room-closed-card").getByRole("button", { name: "CLOSE ROOM" }).click();
  await p.waitForURL((u) => !/\/r\//.test(u.toString()), { timeout: 60000 });
  console.log("closed, now at", p.url(), "errors", errs);
  await b.close();
})();
