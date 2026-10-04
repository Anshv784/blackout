// Two browsers: host makes a private room, friend joins by code, host kicks them, code rotates.
import { chromium } from "playwright";
const URL = "http://127.0.0.1:5173/";
const init = (n: string) => `localStorage.setItem('bo-intro-seen','1');localStorage.setItem('bo-guest','1');localStorage.setItem('bo-name','${n}')`;
(async () => {
  const b = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
  const errs: string[] = [];
  const page = async (n: string) => {
    const ctx = await b.newContext({ viewport: { width: 1400, height: 860 } });
    await ctx.addInitScript(init(n));
    const p = await ctx.newPage();
    p.on("pageerror", (e) => errs.push(`${n}: ${e}`));
    return p;
  };
  const host = await page("HOSTY");
  await host.goto(URL);
  await host.getByRole("button", { name: /PRIVATE ROOM FOR FRIENDS/ }).click({ timeout: 30000 });
  await host.waitForURL(/code=/, { timeout: 60000 });
  const code = (await host.locator(".room-code").textContent({ timeout: 30000 }))!.trim();
  console.log("host url", host.url(), "code", code);
  await host.screenshot({ path: "demo/private-host.png" });

  const friend = await page("FRIENDO");
  await friend.goto(URL);
  // a stranger opening the bare room URL is asked for the code
  const id = host.url().match(/\/r\/(\d+)/)![1];
  await friend.goto(`${URL}#/r/${id}`);
  await friend.getByText("needs a code").waitFor({ timeout: 30000 });
  await friend.screenshot({ path: "demo/private-locked.png" });
  await friend.goto(URL);
  await friend.locator(".join-code input").fill(code);
  await friend.getByRole("button", { name: "JOIN PRIVATE ROOM" }).click();
  await friend.waitForURL(/\/r\//, { timeout: 30000 });
  await friend.getByText(/Waiting for HOSTY/).waitFor({ timeout: 45000 });
  console.log("friend seated");

  await host.locator(".make-host.kick").first().click({ timeout: 30000, force: true });
  await host.screenshot({ path: "demo/private-kick-confirm.png" });
  await host.locator(".room-closed-card").getByRole("button", { name: "KICK" }).click();
  await friend.getByText("The host removed you").waitFor({ timeout: 45000 });
  await friend.screenshot({ path: "demo/private-kicked.png" });
  await host.waitForTimeout(3000);
  const code2 = (await host.locator(".room-code").textContent())!.trim();
  console.log("kicked; code rotated", code, "->", code2, code !== code2);
  await host.screenshot({ path: "demo/private-host-after.png" });
  console.log("errors", errs);
  await b.close();
})();
