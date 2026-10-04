import { chromium } from "playwright";
const b = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
await ctx.addInitScript(() => localStorage.setItem("bo-intro-seen", "1"));
const p = await ctx.newPage();
await p.goto("http://127.0.0.1:5173/#/board"); await p.waitForSelector(".podium", { timeout: 30000 }); await p.waitForTimeout(3000);
await p.screenshot({ path: process.argv[2], fullPage: false });
await b.close();
