// Capture a ~50s scripted product demo of Inferno.
//   * Records a real WEBM video (Playwright native — no ffmpeg needed)
//       -> docs/demo/inferno-demo.webm
//   * Samples PNG frames (densely during animations) for a looping GIF
//       -> docs/demo/frames/*.png   (assembled by scripts/make_gif.py)
//
// Needs the stack on :5173 (or a static `dist` served and pointed at the
// gateway) + at least the dummy-echo worker. Heavier models (yolo/whisper)
// are toured only if present; failures are skipped so the demo never breaks.
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const demoDir = join(here, "..", "docs", "demo");
const framesDir = join(demoDir, "frames");
const videoDir = join(demoDir, "video");
const URL = process.env.DEMO_URL ?? "http://localhost:5173";

rmSync(framesDir, { recursive: true, force: true });
rmSync(videoDir, { recursive: true, force: true });
mkdirSync(framesDir, { recursive: true });
mkdirSync(videoDir, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1,
  colorScheme: "dark",
  recordVideo: { dir: videoDir, size: { width: 1280, height: 800 } },
});
const page = await context.newPage();
page.setDefaultTimeout(10000); // a missing selector fails fast, never stalls the demo

let frame = 0;
const pad = (n) => String(n).padStart(4, "0");
// one still frame
const grab = async () => {
  await page.screenshot({ path: join(framesDir, `f${pad(frame++)}.png`) });
};
// capture `n` frames spread across `ms` — use this to record animation/motion
const hold = async (ms, n) => {
  const gap = Math.max(1, Math.floor(ms / n));
  for (let i = 0; i < n; i++) {
    await page.waitForTimeout(gap);
    await grab();
  }
};
const safe = async (label, fn) => {
  try {
    await fn();
  } catch (e) {
    console.log(`skip ${label}: ${e.message}`);
  }
};

console.log("demo: loading", URL);
await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector("text=Inferno");
await page.waitForTimeout(3500);
await hold(1500, 4); // dashboard establishing shot

// --- Submit a quick text job (dummy-echo) so a result lands ---
await safe("submit", async () => {
  // dummy-echo is the default model; selecting the chip explicitly is a nicety.
  await safe("pick-model", () =>
    page.getByRole("button", { name: "dummy-echo" }).first().click({ timeout: 4000 }),
  );
  await page.waitForTimeout(300);
  await page.fill("textarea", "Distributed inference, batched and streamed in real time.");
  await grab();
  await page.getByRole("button", { name: /Run inference/ }).click();
  await hold(2500, 6); // result streams back
});

// --- Stress test: throughput chart + batch sizes come alive ---
await safe("stress", async () => {
  await page.getByRole("button", { name: "×500" }).click();
  await hold(9000, 26); // dense sampling: live charts animate, batches climb
  await safe("stress-stop", () =>
    page.getByRole("button", { name: "stop" }).click({ timeout: 3000 }),
  );
  await hold(1200, 3);
});

// --- Command palette ---
await safe("palette", async () => {
  await page.keyboard.press("Control+k");
  await hold(1600, 4);
  await page.keyboard.press("Escape");
});

// --- Theme switch (Synthwave) via the palette ---
await safe("theme", async () => {
  await page.keyboard.press("Control+k");
  await page.waitForTimeout(400);
  await page.fill('input[placeholder*="command"]', "Synthwave");
  await page.waitForTimeout(350);
  await page.keyboard.press("Enter");
  await hold(1800, 5);
});

// --- Fleet Command map: worldwide fleet (zoom out to reveal global traffic) ---
await safe("fleet", async () => {
  await page.locator("header").getByRole("button", { name: "Fleet" }).click();
  await page.waitForTimeout(2200); // tiles
  // zoom out to the whole world so the worldwide fleet is visible
  await page.mouse.move(640, 380);
  for (let i = 0; i < 12; i++) {
    await page.mouse.wheel(0, 110);
    await page.waitForTimeout(140);
  }
  await page.waitForTimeout(2800); // world vehicles populate + drift
  // refresh the gallery's Fleet screenshot with the new worldwide view
  await safe("fleet-shot", () =>
    page.screenshot({ path: join(here, "..", "docs", "screenshots", "09-fleet-map.png") }),
  );
  await hold(7000, 22); // GIF frames of global traffic
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
});

// --- History (date + item filters) ---
await safe("history", async () => {
  await page.locator("header").getByRole("button", { name: "History" }).click();
  await hold(2200, 5);
  await page.keyboard.press("Escape");
});

// --- Recent activity slide-over ---
await safe("activity", async () => {
  await page.locator("header").getByRole("button", { name: /Recent/ }).click();
  await hold(1800, 4);
  await page.keyboard.press("Escape");
});

// --- Settle back to a clean dashboard to close the loop ---
await safe("outro", async () => {
  await page.keyboard.press("Control+k");
  await page.waitForTimeout(350);
  await page.fill('input[placeholder*="command"]', "Midnight");
  await page.waitForTimeout(300);
  await page.keyboard.press("Enter");
  await hold(1600, 4);
});

console.log(`demo: captured ${frame} frames`);
await context.close(); // finalizes the webm
await browser.close();

// Rename the webm to a stable path.
import { readdirSync, renameSync } from "node:fs";
const webm = readdirSync(videoDir).find((f) => f.endsWith(".webm"));
if (webm) {
  renameSync(join(videoDir, webm), join(demoDir, "inferno-demo.webm"));
  console.log("demo: video -> docs/demo/inferno-demo.webm");
}
