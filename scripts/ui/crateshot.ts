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
  const before = await p.locator(".cmp-deg").innerText();
  // crosshair dragged to the very bottom (below your body): this used to flip the camera to your face
  await p.mouse.move(700, 850);
  await p.waitForTimeout(5000);
  const after = await p.locator(".cmp-deg").innerText();
  console.log("clock", await p.locator(".hud-clock").innerText());
  console.log("heading before", before, "after 5s with mouse at bottom", after);
  await p.screenshot({ path: "demo/flip-test.png" });
  await p.mouse.move(700, 320);
  await p.keyboard.press("v");
  for (let i = 0; i < 6; i++) {
    await p.keyboard.down(["w", "a", "s", "d"][i % 4]);
    await p.waitForTimeout(1500);
    await p.keyboard.up(["w", "a", "s", "d"][i % 4]);
    await p.screenshot({ path: `demo/crate-${i}.png` });
    const n = await p.locator(".loot-tag:visible").count();
    console.log("shot", i, "visible loot tags", n);
  }
  console.log("errors", errs);
  await b.close();
})();
