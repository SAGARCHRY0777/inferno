/**
 * A worldwide fleet seeded across the globe. Vehicles exist everywhere, but the
 * map only ever STEPS and RENDERS the ones inside the current viewport (see
 * FleetMap) — so panning anywhere shows local traffic instantly, while RAM/CPU
 * stay flat regardless of the global count.
 */
import { type Car, type Domain, randomCarOf } from "./cars";
import { type LatLng } from "./fleet";

export interface WorldVehicle {
  id: string;
  car: Car;
  domain: Domain;
  pos: LatLng;
  home: LatLng;
  heading: number; // degrees, 0 = north
  speedDeg: number; // degrees of travel per simulated second (small)
}

// Land anchors (major cities) → road traffic clusters here.
const LAND: LatLng[] = [
  [40.71, -74.01], [34.05, -118.24], [41.88, -87.63], [43.65, -79.38], [19.43, -99.13],
  [51.51, -0.13], [48.85, 2.35], [52.52, 13.4], [41.9, 12.5], [40.42, -3.7], [55.76, 37.62],
  [41.01, 28.98], [35.68, 139.69], [37.57, 126.98], [39.9, 116.4], [31.23, 121.47],
  [22.32, 114.17], [1.35, 103.82], [13.76, 100.5], [-6.21, 106.85], [19.08, 72.88],
  [28.61, 77.21], [12.97, 77.59], [25.2, 55.27], [30.04, 31.24], [6.52, 3.38],
  [-1.29, 36.82], [-26.2, 28.05], [-33.87, 151.21], [-37.81, 144.96], [-23.55, -46.63],
  [-34.6, -58.38], [-12.05, -77.04], [4.71, -74.07], [45.5, -73.57], [47.61, -122.33],
  [37.77, -122.42], [49.28, -123.12], [59.33, 18.07], [52.37, 4.9], [50.85, 4.35],
];
// Sea anchors (open ocean / shipping lanes) → ships + submarines.
const SEA: LatLng[] = [
  [40, -40], [0, -25], [-30, -10], [30, -150], [0, -160], [-30, -120], [-20, 80], [15, 65],
  [12, 88], [12, 114], [35, 18], [15, -75], [50, 0], [25, -90], [20, 38], [56, 3],
  [-38, 160], [58, -178], [-45, -60], [5, -45],
];

function pick<T>(a: T[]): T {
  return a[Math.floor(Math.random() * a.length)];
}
function jitter(p: LatLng, deg: number): LatLng {
  return [p[0] + (Math.random() - 0.5) * deg, p[1] + (Math.random() - 0.5) * deg];
}

export function makeWorldFleet(n: number): WorldVehicle[] {
  const out: WorldVehicle[] = [];
  for (let i = 0; i < n; i++) {
    const r = Math.random();
    let domain: Domain;
    let anchor: LatLng;
    if (r < 0.55) {
      domain = "road";
      anchor = pick(LAND);
    } else if (r < 0.7) {
      domain = "air";
      anchor = Math.random() < 0.5 ? pick(LAND) : pick(SEA);
    } else if (r < 0.9) {
      domain = "sea";
      anchor = pick(SEA);
    } else {
      domain = "underwater";
      anchor = pick(SEA);
    }
    const pos = jitter(anchor, domain === "road" ? 0.6 : 3);
    out.push({
      id: `WV-${i}`,
      car: randomCarOf(domain),
      domain,
      pos,
      home: pos,
      heading: Math.random() * 360,
      speedDeg: (domain === "air" ? 0.012 : domain === "road" ? 0.004 : 0.006) * (0.6 + Math.random()),
    });
  }
  return out;
}

const MAX_WANDER = { road: 0.5, sea: 3.5, air: 5, underwater: 3.5 };

/** Drift a vehicle around its home (pure — returns a new WorldVehicle). */
export function stepWorldVehicle(v: WorldVehicle, dt: number): WorldVehicle {
  const dLatHome = v.home[0] - v.pos[0];
  const dLngHome = v.home[1] - v.pos[1];
  const fromHome = Math.hypot(dLatHome, dLngHome);
  let heading = v.heading + (Math.random() - 0.5) * 18; // gentle random turn
  if (fromHome > MAX_WANDER[v.domain]) {
    // steer back toward home
    heading = (Math.atan2(dLngHome, dLatHome) * 180) / Math.PI;
  }
  const step = v.speedDeg * dt;
  const hr = (heading * Math.PI) / 180;
  const lat = v.pos[0] + Math.cos(hr) * step;
  const lng = v.pos[1] + (Math.sin(hr) * step) / Math.max(0.2, Math.cos((lat * Math.PI) / 180));
  return { ...v, pos: [lat, lng], heading: ((heading % 360) + 360) % 360 };
}

export function spawnAt(center: LatLng, car?: Car, domain: Domain = "road"): WorldVehicle {
  const pos = jitter(center, 0.05);
  return {
    id: `WV-${Math.floor(Math.random() * 1e9)}`,
    car: car ?? randomCarOf(domain),
    domain: car ? (car.domain ?? "road") : domain,
    pos,
    home: pos,
    heading: Math.random() * 360,
    speedDeg: 0.005 * (0.6 + Math.random()),
  };
}
