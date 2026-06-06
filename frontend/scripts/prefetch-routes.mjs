// Bake real-road geometry into src/lib/fleet.ts using the free OSRM demo server.
// Manual, NOT wired into `build` (so CI/screenshot builds need no network).
//   node scripts/prefetch-routes.mjs   (or: npm run prefetch:routes)
//
// Mirrors osrmUrl()/osrmToLatLngs() in fleet.ts: OSRM speaks [lng,lat], the app
// speaks [lat,lng]. Fetches each closed loop sequentially (>=1s apart, per the
// demo server's <=1 req/s policy), falls back to the sparse loop on any failure,
// re-closes the densified ring, and rewrites the PREFETCH block in fleet.ts.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const fleetPath = join(here, "..", "src", "lib", "fleet.ts");

// The 4 sparse closed loops (must match STRAIGHT_ROUTES in fleet.ts).
const STRAIGHT_ROUTES = [
  [[37.7916, -122.3989], [37.7937, -122.4079], [37.7894, -122.4126], [37.7816, -122.4101], [37.7791, -122.4007], [37.7853, -122.3953], [37.7916, -122.3989]],
  [[37.7699, -122.4330], [37.7765, -122.4310], [37.7808, -122.4240], [37.7780, -122.4150], [37.7700, -122.4170], [37.7660, -122.4260], [37.7699, -122.4330]],
  [[37.8085, -122.4100], [37.8010, -122.4180], [37.7920, -122.4230], [37.7850, -122.4310], [37.7800, -122.4250], [37.7900, -122.4150], [37.8000, -122.4080], [37.8085, -122.4100]],
  [[37.7600, -122.3980], [37.7680, -122.3950], [37.7740, -122.4010], [37.7720, -122.4110], [37.7640, -122.4120], [37.7585, -122.4050], [37.7600, -122.3980]],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const osrmUrl = (wps) =>
  `https://router.project-osrm.org/route/v1/driving/${wps.map(([lat, lng]) => `${lng},${lat}`).join(";")}?overview=full&geometries=geojson&steps=false`;

async function fetchRoute(wps, attempt = 0) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 9000);
  try {
    const res = await fetch(osrmUrl(wps), { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.code !== "Ok" || !data.routes?.length) throw new Error(data.code ?? "no route");
    return data.routes[0].geometry.coordinates.map(([lng, lat]) => [lat, lng]);
  } catch (e) {
    if (attempt < 2) {
      await sleep(600);
      return fetchRoute(wps, attempt + 1);
    }
    console.warn(`  ! route failed (${e.message}); using sparse fallback`);
    return null;
  } finally {
    clearTimeout(t);
  }
}

function reclose(route) {
  const a = route[0];
  const b = route[route.length - 1];
  if (Math.abs(a[0] - b[0]) > 1e-6 || Math.abs(a[1] - b[1]) > 1e-6) route.push([a[0], a[1]]);
  return route;
}

const fmt = (route) =>
  "[" + route.map(([lat, lng]) => `[${lat.toFixed(6)},${lng.toFixed(6)}]`).join(",") + "]";

console.log("Fetching real-road geometry from OSRM…");
const baked = [];
let allOk = true;
for (let i = 0; i < STRAIGHT_ROUTES.length; i++) {
  const dense = await fetchRoute(STRAIGHT_ROUTES[i]);
  if (dense) {
    reclose(dense);
    console.log(`  route ${i}: ${dense.length} road points`);
    baked.push(dense);
  } else {
    allOk = false;
    baked.push(STRAIGHT_ROUTES[i]);
  }
  if (i < STRAIGHT_ROUTES.length - 1) await sleep(1100); // respect <=1 req/s
}

const source = allOk ? "osrm" : "fallback";
const literal = "[\n  " + baked.map(fmt).join(",\n  ") + ",\n]";
const block =
  `// PREFETCH:BEGIN (generated; do not edit by hand)\n` +
  `export const ROUTE_GEOMETRY: LatLng[][] = ${literal};\n` +
  `export const ROUTE_GEOMETRY_SOURCE = ${JSON.stringify(source)};\n` +
  `// PREFETCH:END`;

const src = readFileSync(fleetPath, "utf8");
const next = src.replace(/\/\/ PREFETCH:BEGIN[\s\S]*?\/\/ PREFETCH:END/, block);
if (next === src) {
  console.error("ERROR: PREFETCH markers not found in fleet.ts");
  process.exit(1);
}
writeFileSync(fleetPath, next);
console.log(`Done. source=${source}. Wrote dense geometry into ${fleetPath}`);
