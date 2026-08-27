import L from "leaflet";
import { useEffect, useRef, useState } from "react";
import { Marker, Popup, useMap, useMapEvents } from "react-leaflet";

import { type Car, carDisplay, domainOf, flag, iconOf, randomCarOfCategory } from "@/lib/cars";
import { categoryForDetection, type LatLng, routeThrough } from "@/lib/fleet";
import {
  asDetected,
  isDetected,
  isEvictable,
  makeWorldFleet,
  spawnAt,
  spawnLocal,
  stepWorldVehicle,
  type WorldVehicle,
} from "@/lib/world";

const TICK = 120;
const TIME_SCALE = 26;
const CAP = 240; // max markers rendered at once (keeps DOM/RAM flat at any zoom)
const FLEET_SIZE = 1400;
/** Below this many vehicles on screen, seed local traffic so the map is alive. */
const MIN_IN_VIEW = 18;
/** The public OSRM demo asks for <=1 req/s; stay well under it. */
const ROAD_FETCH_MIN_MS = 2500;
/** Re-seed the view roughly every 5s (TICK=120ms) so it never thins out. */
const TOPUP_EVERY_TICKS = 40;
/** Ambient traffic. */
const CYAN = "#00E5FF";
/** Vehicles spawned from a YOLO detection, so the model's output stands out. */
const GOLD = "#FFB020";
/** Ceiling on seeded local vehicles, so panning around can't grow the fleet forever. */
const MAX_LOCAL = 400;

export interface WorldApi {
  add: (car?: Car) => void;
  /**
   * Spawn one local vehicle per YOLO vehicle label, in view.
   * This is how a detection result becomes live traffic on the map.
   * Returns how many were actually spawned.
   */
  addDetected: (labels: string[]) => number;
}

// react-leaflet compares `props.icon` by identity and calls marker.setIcon() —
// which replaces the marker's DOM element — whenever it differs. Building a fresh
// DivIcon inline in render therefore rebuilt every marker's DOM on every tick:
// at CAP=240 markers and TICK=120ms that is ~2000 icon replacements per second,
// which is visible jank while panning or zooming. Heading is quantised to 5° so
// the cache stays small and stable across ticks.
const iconCache = new Map<string, L.DivIcon>();

function icon(v: WorldVehicle): L.DivIcon {
  // The key must capture everything buildIcon actually renders:
  //  • road   -> one arrow shape, ROTATED by heading (quantised to 5°).
  //  • others -> a per-vehicle emoji with NO rotation, so heading is irrelevant
  //              but the emoji is not — keying on domain alone would render every
  //              ship, tanker, trawler and icebreaker with the same glyph.
  const key =
    domainOf(v.car) === "road"
      ? `road:${isDetected(v) ? "det" : "amb"}:${Math.round(v.heading / 5) * 5}`
      : `glyph:${iconOf(v.car)}`;
  const hit = iconCache.get(key);
  if (hit) return hit;
  const made = buildIcon(v);
  iconCache.set(key, made);
  return made;
}

function buildIcon(v: WorldVehicle): L.DivIcon {
  if (domainOf(v.car) === "road") {
    // Gold = spawned from a YOLO detection, cyan = ambient traffic. This makes
    // the model's output legible at a glance: you can see exactly which vehicles
    // came out of the photo you submitted.
    const colour = isDetected(v) ? GOLD : CYAN;
    const size = isDetected(v) ? 14 : 11;
    return L.divIcon({
      className: "av-marker",
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
      html: `<div style="transform:rotate(${v.heading}deg);filter:drop-shadow(0 0 ${
        isDetected(v) ? 5 : 3
      }px ${colour})">
        <svg width="${size}" height="${size}" viewBox="0 0 16 16"><path d="M8 1 L13 14 L8 11 L3 14 Z"
        fill="${colour}" stroke="#0A0B0F" stroke-width="0.7"/></svg></div>`,
    });
  }
  return L.divIcon({
    className: "",
    iconSize: [15, 15],
    iconAnchor: [7.5, 7.5],
    html: `<div style="font-size:12px;line-height:15px;text-align:center">${iconOf(v.car)}</div>`,
  });
}

/**
 * A worldwide fleet rendered with viewport culling: the full fleet lives in a
 * ref, but only vehicles inside the current map bounds are stepped + drawn (and
 * capped at CAP), so panning anywhere instantly shows local traffic while RAM
 * stays flat regardless of the global count.
 */
export function WorldFleet({
  hidden,
  paused,
  api,
  onCounts,
}: {
  hidden: boolean;
  paused: boolean;
  api: React.MutableRefObject<WorldApi | null>;
  onCounts?: (visible: number, total: number) => void;
}) {
  const map = useMap();
  const fleet = useRef<WorldVehicle[]>([]);
  if (fleet.current.length === 0) fleet.current = makeWorldFleet(FLEET_SIZE);
  const [visible, setVisible] = useState<WorldVehicle[]>([]);
  const lastCount = useRef(-1);

  // --- real road geometry for local traffic -------------------------------- //
  // One dense OSRM circuit per view, shared by every local vehicle there. This
  // is what stops cars flying over buildings and water: every point on the
  // polyline is on an actual street.
  //
  // Exactly ONE request per new view, throttled — the public OSRM demo server
  // asks for <=1 req/s (see scripts/prefetch-routes.mjs), so a request per
  // vehicle would be abusive and slow.
  const roadLoop = useRef<LatLng[] | null>(null);
  const roadKey = useRef<string>("");
  const roadFetching = useRef(false);
  const lastRoadFetch = useRef(0);

  const ensureRoadLoop = async (center: LatLng, spread: number) => {
    // Quantise the view so small pans reuse the same circuit.
    const key = `${center[0].toFixed(2)},${center[1].toFixed(2)},${spread.toFixed(2)}`;
    if (key === roadKey.current || roadFetching.current) return;
    if (Date.now() - lastRoadFetch.current < ROAD_FETCH_MIN_MS) return;
    // Above a city-ish zoom the streets aren't visible anyway, and a "circuit"
    // spanning half a continent is meaningless.
    if (spread > 0.35) return;

    roadFetching.current = true;
    lastRoadFetch.current = Date.now();
    try {
      const r = spread * 0.6;
      const ring: LatLng[] = [0, 1, 2, 3].map((i) => {
        const angle = (i / 4) * Math.PI * 2 + Math.random() * 0.4;
        return [center[0] + Math.sin(angle) * r, center[1] + Math.cos(angle) * r];
      });
      const plan = await routeThrough([...ring, ring[0]]);
      if (plan && plan.geometry.length > 8) {
        roadLoop.current = plan.geometry;
        roadKey.current = key;
      }
    } catch {
      /* keep whatever circuit we already had; straight-line fallback covers it */
    } finally {
      roadFetching.current = false;
    }
  };

  const cull = (step: boolean) => {
    const b = map.getBounds();
    const dt = (TICK / 1000) * TIME_SCALE;
    const arr = fleet.current;
    const vis: WorldVehicle[] = [];
    for (let i = 0; i < arr.length; i++) {
      // Step EVERY vehicle, cull only what we RENDER.
      //
      // This used to step only vehicles already inside the padded viewport,
      // which froze the entire world off-screen: a vehicle outside the view
      // never moved, so none could ever drive INTO the view. You saw only
      // whatever happened to spawn on screen at load — which at the default
      // city zoom is usually nothing, hence a permanently empty "0 in view".
      // Stepping is a few arithmetic ops; it is rendering 1400 markers that is
      // expensive, and that is still capped at CAP below.
      if (step) arr[i] = stepWorldVehicle(arr[i], dt);
      if (vis.length < CAP && b.contains(arr[i].pos as L.LatLngExpression)) vis.push(arr[i]);
    }
    setVisible(vis);
    if (onCounts && vis.length !== lastCount.current) {
      lastCount.current = vis.length;
      onCounts(vis.length, arr.length);
    }
    return vis.length;
  };

  /**
   * Guarantee the map is never dead: if the view is nearly empty, seed short
   * local trips around wherever the user is looking. Intercity routes between
   * ~96 global endpoints simply do not pass through a zoom-13 city view often
   * enough to carry the feature on their own.
   */
  const ensureLocalTraffic = () => {
    const c = map.getCenter();
    const b = map.getBounds();
    // Roughly the visible radius, so trips stay in frame long enough to watch.
    const spread = Math.max(0.01, Math.min(0.6, (b.getNorth() - b.getSouth()) / 2));
    const arr = fleet.current;
    const inView = arr.reduce(
      (n, v) => (b.contains(v.pos as L.LatLngExpression) ? n + 1 : n),
      0,
    );
    if (inView >= MIN_IN_VIEW) return;

    // Kick off (or reuse) a real road circuit for this view. The first spawn
    // after a pan may still be straight-line; once the geometry lands, every
    // subsequent vehicle drives actual streets.
    void ensureRoadLoop([c.lat, c.lng], spread);
    const roads = roadLoop.current;

    for (let i = inView; i < MIN_IN_VIEW; i++) {
      arr.push(spawnLocal([c.lat, c.lng], spread, undefined, roads ?? undefined));
    }
    // Bound the growth from panning around by retiring the oldest AMBIENT local
    // vehicles. Detected vehicles are excluded: they are the user's own YOLO
    // result, and evicting them first deleted exactly what the feature exists to
    // show. The worldwide fleet is never evicted either.
    const evictable = arr.reduce((n, v) => (isEvictable(v) ? n + 1 : n), 0);
    if (evictable > MAX_LOCAL) {
      let toDrop = evictable - MAX_LOCAL;
      const kept: WorldVehicle[] = [];
      for (const v of arr) {
        if (toDrop > 0 && isEvictable(v)) {
          toDrop--;          // explicit loop: the old filter relied on a
          continue;          // postfix-decrement side effect inside a predicate
        }
        kept.push(v);
      }
      fleet.current = kept;
    }
    cull(false);
  };

  // expose add() to the parent (spawns near the current map center, in view)
  useEffect(() => {
    api.current = {
      add: (car) => {
        const c = map.getCenter();
        fleet.current.push(spawnAt([c.lat, c.lng], car));
        cull(false);
      },
      addDetected: (labels) => {
        const c = map.getCenter();
        const b = map.getBounds();
        // Spread them across the visible area rather than stacking on the pin.
        const spread = Math.max(0.008, Math.min(0.4, (b.getNorth() - b.getSouth()) / 2.5));
        let spawned = 0;
        for (const label of labels) {
          const category = categoryForDetection(label);
          if (!category) continue; // not a vehicle class (person, traffic light, ...)
          fleet.current.push(
            asDetected(
              spawnLocal(
                [c.lat, c.lng],
                spread,
                randomCarOfCategory(category),
                roadLoop.current ?? undefined,
              ),
            ),
          );
          spawned++;
        }
        if (spawned) cull(false);
        return spawned;
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  // re-cull when the map moves, and top up local traffic for the new view
  useMapEvents({ moveend: () => ensureLocalTraffic(), zoomend: () => ensureLocalTraffic() });
  // initial population
  useEffect(() => {
    ensureLocalTraffic();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // animate the in-view vehicles
  useEffect(() => {
    if (hidden || paused) return;
    let tick = 0;
    const id = window.setInterval(() => {
      cull(true);
      // Top the view up periodically, not only on pan/zoom: local vehicles drive
      // off the edge of the circuit over time, so a stationary view would slowly
      // empty out again. ~every 5s is far below the OSRM throttle.
      if (++tick % TOPUP_EVERY_TICKS === 0) ensureLocalTraffic();
    }, TICK);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hidden, paused]);

  if (hidden) return null;
  return (
    <>
      {visible.map((v) => (
        <Marker key={v.id} position={v.pos} icon={icon(v)}>
          <Popup>
            <div className="text-xs leading-relaxed">
              <b>{carDisplay(v.car)}</b>
              <br />
              {flag(v.car.country)} {v.car.country} · {v.car.type}
              <br />
              {iconOf(v.car)} {v.fromName} → {v.toName} ({Math.round(v.t * 100)}%)
              <br />
              📦 {v.cargo}
            </div>
          </Popup>
        </Marker>
      ))}
    </>
  );
}
