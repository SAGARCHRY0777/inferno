// Captures UI screenshots with Playwright (headless Chromium).
// Run from frontend/:  node screenshot.mjs
// Assumes gateway + workers + dashboard load are running and Vite is on :5173.
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "docs", "screenshots");
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 2,
  colorScheme: "dark",
});

await page.goto("http://localhost:5173", { waitUntil: "networkidle" });
await page.waitForSelector("text=Inferno");
await page.waitForTimeout(4000); // let charts fill

try {
  await page.click("text=Run inference →");
  await page.waitForTimeout(1800);
} catch {
  /* ignore if label differs */
}
await page.waitForTimeout(1500);

await page.screenshot({ path: join(outDir, "console-full.png"), fullPage: true });
await page.screenshot({ path: join(outDir, "console-viewport.png") });

// History modal
try {
  await page.click("text=History");
  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(outDir, "console-history.png") });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
} catch {
  /* ignore */
}

// Command palette
try {
  await page.keyboard.press("Control+k");
  await page.waitForTimeout(900);
  await page.screenshot({ path: join(outDir, "console-palette.png") });
  await page.keyboard.press("Escape");
} catch {
  /* ignore */
}

console.log("Saved screenshots to", outDir);
await browser.close();
