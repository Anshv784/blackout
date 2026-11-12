// A guest in a free room asks the host to start; the host's START button lights up.
import { chromium } from "playwright";
(async () => {
  const S = process.argv[2] ?? "/tmp";
  const b = await chromium.launch({ channel: "chrome", args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
  const mk = async (name: string) => {
    const ctx = await b.newContext({ viewport: { width: 1300, height: 820 } });
    await ctx.addInitScript(`localStorage.setItem('bo-intro-seen','1');localStorage.setItem('bo-guest','1');localStorage.setItem('bo-name','${name}');localStorage.setItem('bo-prefs-v1', JSON.stringify({weather:false}))`);
    const p = await ctx.newPage();
    p.on("pageerror", (e) => console.log(name, "error", String(e)));
    return p;
  };
  const host = await mk("HOSTY");
  await host.goto("http://127.0.0.1:5173/");
  await host.getByRole("button", { name: /CREATE ROOM/ }).click({ timeout: 30000 });
  await host.waitForURL(/\/r\//, { timeout: 60000 });
  await host.getByRole("button", { name: "START THE NIGHT" }).waitFor({ timeout: 60000 });
  const guest = await mk("GUESTY");
  await guest.goto(host.url());
  await guest.getByRole("button", { name: "TAKE A SEAT" }).click({ timeout: 60000 }).catch(() => {});
  const ask = guest.getByRole("button", { name: "ASK TO START" });
  const ok = await ask.waitFor({ timeout: 60000 }).then(() => true, () => false);
  console.log(ok ? "PASS guest sees ASK TO START" : "FAIL no ASK TO START for the guest");
  await guest.waitForTimeout(3000);
  await ask.click({ noWaitAfter: true });
  await guest.waitForTimeout(2000);
  console.log("guest url", guest.url(), "toasts", await guest.evaluate(() => JSON.stringify((window as any).__store?.getState().toasts?.slice(-2))));
  const asked = await guest.getByRole("button", { name: "ASKED ✓" }).waitFor({ timeout: 20000 }).then(() => true, () => false);
  console.log(asked ? "PASS guest's button shows ASKED" : "FAIL guest's button didn't change");
  const lit = await host.locator(".btn.primary.asked").waitFor({ timeout: 20000 }).then(() => true, () => false);
  const who = lit ? await host.locator(".btn.primary.asked small").textContent() : null;
  console.log(lit ? `PASS host's START button lights up: "${who}"` : "FAIL host saw nothing");
  await host.screenshot({ path: `${S}/ask-host.png` });
  await guest.screenshot({ path: `${S}/ask-guest.png` });
  await guest.goto("http://127.0.0.1:5173/");
  await host.goto("http://127.0.0.1:5173/");
  await host.waitForTimeout(3000);
  await b.close();
})();
