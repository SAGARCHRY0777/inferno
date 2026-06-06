// Capture the full screenshot set for the README / GitHub.
// Requires the stack running (gateway + dummy + yolo + whisper workers) and Vite on :5173.
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "docs", "screenshots");
mkdirSync(outDir, { recursive: true });
const bus = join(here, "..", "tools", "bus.jpg");
const flac = join(here, "..", "tools", "mlk.flac");

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 2,
  colorScheme: "dark",
});
const shot = (n) => page.screenshot({ path: join(outDir, n) }).then(() => console.log("saved", n));

await page.goto("http://localhost:5173", { waitUntil: "networkidle" });
await page.waitForSelector("text=Inferno");
await page.waitForTimeout(4500);
await shot("01-dashboard.png");

// --- YOLO object detection with bounding boxes ---
try {
  await page.getByRole("button", { name: "yolo-detect" }).click();
  await page.waitForTimeout(500);
  await page.setInputFiles('input[type="file"]', bus);
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: /Run inference/ }).click();
  await page.waitForSelector("text=detected", { timeout: 90000 });
  await page.waitForTimeout(1500);
  await shot("02-yolo-detection.png");
} catch (e) {
  console.log("yolo failed:", e.message);
}

// --- Whisper speech-to-text ---
try {
  await page.getByRole("button", { name: "whisper-transcribe" }).click();
  await page.waitForTimeout(500);
  await page.setInputFiles('input[type="file"]', flac);
  await page.waitForTimeout(2500);
  await page.getByRole("button", { name: /Run inference/ }).click();
  await page.waitForSelector("text=Transcript", { timeout: 90000 });
  await page.waitForTimeout(1200);
  await shot("07-whisper-transcription.png");
} catch (e) {
  console.log("whisper failed:", e.message);
}

// --- Semantic search (RAG demo) ---
try {
  await page.getByRole("button", { name: "semantic-search" }).click();
  await page.waitForTimeout(400);
  await page.fill("textarea", "how does request batching improve throughput?");
  await page.getByRole("button", { name: /Run inference/ }).click();
  await page.waitForSelector("text=Top matches", { timeout: 60000 });
  await page.waitForTimeout(1200);
  await shot("08-semantic-search.png");
} catch (e) {
  console.log("search failed:", e.message);
}

// --- History with date + item filters ---
try {
  await page.locator("header").getByRole("button", { name: "History" }).click();
  await page.waitForTimeout(1500);
  await shot("03-history.png");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
} catch (e) {
  console.log("history failed:", e.message);
}

// --- Recent activity slide-over ---
try {
  await page.locator("header").getByRole("button", { name: /Recent/ }).click();
  await page.waitForTimeout(1200);
  await shot("05-activity.png");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
} catch (e) {
  console.log("activity failed:", e.message);
}

// --- Command palette ---
try {
  await page.keyboard.press("Control+k");
  await page.waitForTimeout(900);
  await shot("04-command-palette.png");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
} catch (e) {
  console.log("palette failed:", e.message);
}

// --- Fleet Command map (real road geometry + path tracing) ---
try {
  await page.locator("header").getByRole("button", { name: "Fleet" }).click();
  await page.waitForTimeout(2000); // tiles load
  await page.waitForTimeout(6000); // vehicles trace real-road trails
  await shot("09-fleet-map.png");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);
} catch (e) {
  console.log("fleet failed:", e.message);
}

// --- A second theme (Synthwave) for variety ---
try {
  await page.keyboard.press("Control+k");
  await page.waitForTimeout(500);
  await page.fill('input[placeholder*="command"]', "Synthwave");
  await page.waitForTimeout(400);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1400);
  await shot("06-theme-synthwave.png");
} catch (e) {
  console.log("theme failed:", e.message);
}

console.log("done");
await browser.close();
