import { chromium } from "playwright";
(async () => {
  const b = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
  const p = await b.newPage({ viewport: { width: 1400, height: 860 } });
  await p.addInitScript("localStorage.setItem('bo-intro-seen','1');localStorage.setItem('bo-guest','1');localStorage.setItem('bo-name','GHOSTY')");
  await p.goto("http://127.0.0.1:5173/");
  await p.getByRole("button", { name: /STAKED NIGHT/ }).click({ timeout: 30000 });
  await p.getByText("Staked nights need a wallet").waitFor({ timeout: 5000 });
  const guestBtn = await p.getByRole("button", { name: "PLAY AS GUEST" }).count();
  await p.screenshot({ path: "demo/guest-stake.png" });
  console.log("gate shown; guest button count =", guestBtn, "url", p.url());
  await b.close();
})();
