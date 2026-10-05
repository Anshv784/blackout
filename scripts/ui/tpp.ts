import { chromium } from "playwright";
(async () => {
  const b = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
  const ctx = await b.newContext({ viewport: { width: 1400, height: 860 } });
  await ctx.addInitScript("localStorage.setItem('bo-intro-seen','1');localStorage.setItem('bo-guest','1');localStorage.setItem('bo-name','TESTER');localStorage.setItem('bo-prefs-v1', JSON.stringify({weather:false}))");
  const p = await ctx.newPage();
  const errs: string[] = [];
  p.on("pageerror", (e) => errs.push(String(e)));
  await p.goto("http://127.0.0.1:5173/");
  await p.getByRole("button", { name: /CREATE A ROOM/ }).click({ timeout: 30000 });
  await p.waitForURL(/\/r\//, { timeout: 60000 });
  await p.getByRole("button", { name: "START THE NIGHT" }).click({ timeout: 60000 });
  await p.locator(".compass").waitFor({ timeout: 90000 });
  await p.waitForTimeout(4000);
  console.log("prompt shown:", await p.locator(".click-to-play").count());
  await p.screenshot({ path: "demo/tpp-prompt.png" });
  // headless Chrome can't capture the mouse: pretend it did, so the mouse-look path runs
  await p.evaluate(`Object.defineProperty(document, "pointerLockElement", { get: () => document.querySelector(".game canvas"), configurable: true }); document.dispatchEvent(new Event("pointerlockchange"));`);
  await p.waitForTimeout(700);
  const locked = await p.evaluate(`!!document.pointerLockElement`);
  console.log("pointer locked:", locked);
  const h0 = await p.locator(".cmp-deg").innerText();
  // turn right: synthesize relative mouse motion
  for (let i = 0; i < 20; i++) {
    await p.evaluate(`document.dispatchEvent(new MouseEvent("mousemove", { movementX: 25, movementY: -4, bubbles: true }))`);
  }
  await p.waitForTimeout(400);
  const h1 = await p.locator(".cmp-deg").innerText();
  console.log("heading", h0, "->", h1);
  await p.keyboard.down("w");
  await p.waitForTimeout(2000);
  await p.keyboard.up("w");
  await p.screenshot({ path: "demo/tpp.png" });
  console.log("errors", errs);
  await b.close();
})();
