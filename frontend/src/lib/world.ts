/**
 * A worldwide fleet that makes real point-to-point journeys: planes fly
 * airport→airport, ferries/ships sail port→port, cars drive city→city, subs run
 * ocean→ocean — each carrying cargo. The map only steps + renders the vehicles
 * inside the current viewport (see WorldFleet), so it scales to any size at flat
 * RAM/CPU.
 */
import { type Car, type Domain, type CarType, randomCarOf } from "./cars";
import { bearing, type LatLng } from "./fleet";

type Loc = [number, number, string]; // lat, lng, name

const AIRPORTS: Loc[] = [
  [40.64, -73.78, "JFK"], [33.94, -118.41, "LAX"], [41.98, -87.9, "ORD"], [37.62, -122.38, "SFO"],
  [47.45, -122.31, "SEA"], [43.68, -79.61, "YYZ"], [19.44, -99.07, "MEX"], [51.47, -0.45, "LHR"],
  [49.01, 2.55, "CDG"], [50.04, 8.56, "FRA"], [52.31, 4.76, "AMS"], [40.47, -3.56, "MAD"],
  [41.8, 12.25, "FCO"], [41.28, 28.74, "IST"], [25.25, 55.36, "DXB"], [28.56, 77.1, "DEL"],
  [19.09, 72.87, "BOM"], [13.2, 77.71, "BLR"], [1.36, 103.99, "SIN"], [22.31, 113.91, "HKG"],
  [35.77, 140.39, "NRT"], [37.46, 126.44, "ICN"], [40.08, 116.58, "PEK"], [31.14, 121.81, "PVG"],
  [-33.95, 151.18, "SYD"], [-37.67, 144.84, "MEL"], [-23.43, -46.47, "GRU"], [-34.82, -58.54, "EZE"],
  [-26.13, 28.24, "JNB"], [30.11, 31.41, "CAI"], [6.58, 3.32, "LOS"], [55.97, 37.41, "SVO"],
];
const PORTS: Loc[] = [
  [31.23, 121.5, "Shanghai"], [1.26, 103.83, "Singapore"], [51.95, 4.14, "Rotterdam"],
  [33.74, -118.26, "Los Angeles"], [53.54, 9.97, "Hamburg"], [51.28, 4.3, "Antwerp"],
  [25.0, 55.06, "Jebel Ali"], [35.1, 129.04, "Busan"], [22.3, 114.18, "Hong Kong"],
  [40.67, -74.04, "New York"], [-23.98, -46.3, "Santos"], [18.94, 72.84, "Mumbai"],
  [-29.87, 31.03, "Durban"], [-33.86, 151.21, "Sydney"], [51.95, 1.31, "Felixstowe"],
  [39.44, -0.32, "Valencia"], [37.94, 23.64, "Piraeus"], [35.61, 139.78, "Tokyo Bay"],
  [49.29, -123.1, "Vancouver"], [6.94, 79.84, "Colombo"], [29.76, -95.0, "Houston"],
];
const CITIES: Loc[] = [
  [40.71, -74.01, "New York"], [34.05, -118.24, "Los Angeles"], [41.88, -87.63, "Chicago"],
  [43.65, -79.38, "Toronto"], [19.43, -99.13, "Mexico City"], [51.51, -0.13, "London"],
  [48.85, 2.35, "Paris"], [52.52, 13.4, "Berlin"], [41.9, 12.5, "Rome"], [40.42, -3.7, "Madrid"],
  [55.76, 37.62, "Moscow"], [41.01, 28.98, "Istanbul"], [35.68, 139.69, "Tokyo"],
  [37.57, 126.98, "Seoul"], [39.9, 116.4, "Beijing"], [31.23, 121.47, "Shanghai"],
  [22.32, 114.17, "Hong Kong"], [1.35, 103.82, "Singapore"], [13.76, 100.5, "Bangkok"],
  [-6.21, 106.85, "Jakarta"], [19.08, 72.88, "Mumbai"], [28.61, 77.21, "Delhi"],
  [12.97, 77.59, "Bengaluru"], [25.2, 55.27, "Dubai"], [30.04, 31.24, "Cairo"],
  [6.52, 3.38, "Lagos"], [-26.2, 28.05, "Johannesburg"], [-33.87, 151.21, "Sydney"],
  [-23.55, -46.63, "São Paulo"], [-34.6, -58.38, "Buenos Aires"], [-12.05, -77.04, "Lima"],
];
const OCEAN: Loc[] = [
  [40, -45, "N Atlantic"], [10, -40, "Mid Atlantic"], [-30, -15, "S Atlantic"],
  [30, -150, "N Pacific"], [0, -155, "Mid Pacific"], [-30, -120, "S Pacific"],
  [-15, 80, "Indian Ocean"], [15, 65, "Arabian Sea"], [12, 90, "Bay of Bengal"],
  [12, 116, "S China Sea"], [35, 18, "Mediterranean"], [15, -75, "Caribbean"],
];

export interface WorldVehicle {
  id: string;
  car: Car;
  domain: Domain;
  from: LatLng;
  to: LatLng;
  fromName: string;
  toName: string;
  legLen: number; // degrees
  t: number; // 0..1 along the current leg
  pos: LatLng;
  heading: number;
  speedDeg: number; // degrees per simulated second
  cargo: string;
}

const rnd = (n: number) => Math.floor(Math.random() * n);
const pick = <T,>(a: T[]): T => a[rnd(a.length)];
const degDist = (a: LatLng, b: LatLng) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function endpoints(domain: Domain): Loc[] {
  // Rail shares the city list: intercity trains run station-to-station between
  // the same major cities, which is exactly what CITIES holds.
  return domain === "air"
    ? AIRPORTS
    : domain === "sea"
      ? PORTS
      : domain === "underwater"
        ? OCEAN
        : CITIES;
}

function maxDegFor(t: CarType): number {
  const m: Partial<Record<CarType, number>> = {
    // air
    airliner: 85, cargoplane: 80, jet: 55, seaplane: 14, helicopter: 12, drone: 3, balloon: 6,
    // sea
    ship: 130, container: 130, seatanker: 120, cruise: 90, ferry: 26, icebreaker: 60,
    tug: 6, fishing: 30, yacht: 30, speedboat: 12, sailboat: 26,
    // underwater
    submarine: 45, submersible: 8, rov: 3,
    // rail — trains run intercity, not intercontinental
    highspeed: 18, freighttrain: 30, metro: 2, tram: 1.5,
    // road commercial
    truck: 24, semi: 30, tanker: 22, dumper: 3, mixer: 3, van: 12, pickup: 16,
    bus: 10, coach: 26, ambulance: 6, firetruck: 4, police: 8,
    motorcycle: 14, scooter: 4, offroad: 18,
  };
  return m[t] ?? 20;
}
function speedFor(t: CarType): number {
  const s: Partial<Record<CarType, number>> = {
    // air
    airliner: 0.07, cargoplane: 0.06, jet: 0.06, seaplane: 0.03, helicopter: 0.03,
    drone: 0.02, balloon: 0.012,
    // sea
    ship: 0.013, container: 0.013, seatanker: 0.011, cruise: 0.016, ferry: 0.02,
    icebreaker: 0.012, tug: 0.01, fishing: 0.014, yacht: 0.022, speedboat: 0.03, sailboat: 0.016,
    // underwater
    submarine: 0.014, submersible: 0.006, rov: 0.004,
    // rail
    highspeed: 0.05, freighttrain: 0.022, metro: 0.02, tram: 0.012,
    // road commercial
    truck: 0.018, semi: 0.019, tanker: 0.017, dumper: 0.008, mixer: 0.008,
    van: 0.021, pickup: 0.023, bus: 0.016, coach: 0.021,
    ambulance: 0.028, firetruck: 0.024, police: 0.03,
    motorcycle: 0.028, scooter: 0.016, offroad: 0.02,
  };
  return s[t] ?? 0.02;
}
function cargoFor(c: Car): string {
  switch (c.type) {
    case "airliner": return `${150 + rnd(280)} passengers`;
    case "jet": return `${4 + rnd(12)} passengers · private charter`;
    case "helicopter": return `${2 + rnd(6)} aboard`;
    case "balloon": return "sightseeing flight";
    case "ship": return `${4000 + rnd(20000)} containers (TEU)`;
    case "cruise": return `${1500 + rnd(5000)} passengers`;
    case "ferry": return `${200 + rnd(1400)} passengers · ${20 + rnd(180)} cars`;
    case "yacht": return `${4 + rnd(18)} guests + crew`;
    case "speedboat": return `${1 + rnd(5)} aboard`;
    case "sailboat": return `${2 + rnd(5)} crew`;
    case "submarine": return `${15 + rnd(110)} crew · classified`;
    case "truck": return `${5 + rnd(35)} t freight`;
    // air
    case "cargoplane": return `${20 + rnd(120)} t air freight`;
    case "seaplane": return `${4 + rnd(14)} passengers · water landing`;
    case "drone": return `${1 + rnd(25)} kg parcel`;
    // sea
    case "container": return `${8000 + rnd(16000)} containers (TEU)`;
    case "seatanker": return `${80 + rnd(240)}k t crude / LNG`;
    case "tug": return `assisting a ${20 + rnd(180)}k t vessel`;
    case "fishing": return `${20 + rnd(400)} t catch`;
    case "icebreaker": return `clearing ${1 + rnd(3)}.${rnd(9)} m ice`;
    // underwater
    case "submersible": return `${2 + rnd(3)} aboard · ${1 + rnd(6)}km depth`;
    case "rov": return "survey · remotely operated";
    // rail
    case "highspeed": return `${300 + rnd(900)} passengers`;
    case "freighttrain": return `${40 + rnd(120)} wagons · ${1000 + rnd(4000)} t`;
    case "metro": return `${400 + rnd(1200)} commuters`;
    case "tram": return `${80 + rnd(200)} passengers`;
    // road · commercial
    case "semi": return `${15 + rnd(30)} t · ${1 + rnd(2)} trailers`;
    case "tanker": return `${10 + rnd(30)}k L fuel`;
    case "pickup": return `${1 + rnd(3)} t payload`;
    case "van": return `${10 + rnd(90)} parcels`;
    case "dumper": return `${30 + rnd(300)} t ore`;
    case "mixer": return `${6 + rnd(6)} m³ concrete`;
    // road · public + emergency
    case "bus": return `${20 + rnd(60)} passengers`;
    case "coach": return `${30 + rnd(50)} passengers · intercity`;
    case "ambulance": return "1 patient · emergency response";
    case "firetruck": return `${2 + rnd(6)} crew · ${1 + rnd(9)}k L water`;
    case "police": return `${1 + rnd(3)} officers · patrol`;
    // road · two-wheelers
    case "motorcycle": return `${1 + rnd(2)} rider${rnd(2) ? "s" : ""}`;
    case "scooter": return "1 rider · city commute";
    default: return `${1 + rnd(4)} passengers`;
  }
}

/** Choose a destination of the right type within range of `from`. */
function destFor(from: LatLng, domain: Domain, t: CarType): Loc {
  const max = maxDegFor(t);
  const cands = endpoints(domain).filter((l) => {
    const d = degDist(from, [l[0], l[1]]);
    return d > 1 && d < max;
  });
  return (cands.length ? pick(cands) : pick(endpoints(domain)));
}

function startLeg(v: WorldVehicle): WorldVehicle {
  const dest = destFor(v.to, v.domain, v.car.type);
  const from = v.to;
  const to: LatLng = [dest[0], dest[1]];
  return {
    ...v,
    from,
    to,
    fromName: v.toName,
    toName: dest[2],
    legLen: Math.max(0.5, degDist(from, to)),
    t: 0,
    pos: from,
    heading: bearing(from, to),
    cargo: cargoFor(v.car),
  };
}

export function makeWorldFleet(n: number): WorldVehicle[] {
  const out: WorldVehicle[] = [];
  for (let i = 0; i < n; i++) {
    const r = Math.random();
    const domain: Domain =
      r < 0.44 ? "road" : r < 0.56 ? "rail" : r < 0.74 ? "air" : r < 0.93 ? "sea" : "underwater";
    const car = randomCarOf(domain);
    const o = pick(endpoints(domain));
    const from: LatLng = [o[0], o[1]];
    const dest = destFor(from, domain, car.type);
    const to: LatLng = [dest[0], dest[1]];
    const t = Math.random();
    out.push({
      id: `WV-${i}`,
      car,
      domain,
      from,
      to,
      fromName: o[2],
      toName: dest[2],
      legLen: Math.max(0.5, degDist(from, to)),
      t,
      pos: [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t],
      heading: bearing(from, to),
      speedDeg: speedFor(car.type) * (0.7 + Math.random() * 0.6),
      cargo: cargoFor(car),
    });
  }
  return out;
}

export function stepWorldVehicle(v: WorldVehicle, dt: number): WorldVehicle {
  const t = v.t + (v.speedDeg * dt) / v.legLen;
  if (t >= 1) {
    // Local traffic keeps circulating locally. Without this it would take a
    // normal intercity leg on arrival and immediately drive off the screen,
    // leaving the view empty again a few seconds after it was seeded.
    // Carry the same car across hops: a bus YOLO detected must stay that bus,
    // not be re-rolled into a random vehicle every time it reaches its stop.
    if (isLocal(v)) return { ...spawnLocal(v.to, 0.05, v.car), id: v.id, t: 0 };
    return startLeg({ ...v, to: v.to }); // arrived → next leg
  }
  return { ...v, t, pos: [v.from[0] + (v.to[0] - v.from[0]) * t, v.from[1] + (v.to[1] - v.from[1]) * t] };
}

/**
 * Local traffic: a short hop entirely inside the current view.
 *
 * The worldwide fleet travels between ~96 global airports/ports/cities, so at a
 * city zoom (the map opens at zoom 13) essentially none of those routes pass
 * through your screen — you get an empty map with "0 in view". These vehicles
 * drive short local legs around wherever you are looking, so the map always has
 * something moving on it.
 *
 * `spreadDeg` should be roughly the visible radius, so trips stay in frame long
 * enough to watch.
 */
export function spawnLocal(center: LatLng, spreadDeg = 0.05, withCar?: Car): WorldVehicle {
  const jitter = (): LatLng => [
    center[0] + (Math.random() - 0.5) * spreadDeg * 2,
    center[1] + (Math.random() - 0.5) * spreadDeg * 2,
  ];
  const car = withCar ?? randomCarOf("road");
  const from = jitter();
  const to = jitter();
  return {
    id: `WL-${rnd(1e9)}`, // WL = local, so the culler can retire these first
    car,
    domain: "road",
    from,
    to,
    fromName: "local",
    toName: "local",
    legLen: Math.max(0.004, degDist(from, to)),
    t: Math.random(), // stagger so they don't all start from the same instant
    pos: from,
    heading: bearing(from, to),
    // Local streets, not intercity: scale the catalogue speed right down so a
    // short hop takes seconds rather than a single frame.
    speedDeg: speedFor(car.type) * 0.06 * (0.7 + Math.random() * 0.6),
    cargo: cargoFor(car),
  };
}

/** True for a vehicle created by {@link spawnLocal}. */
export function isLocal(v: WorldVehicle): boolean {
  return v.id.startsWith("WL-");
}

export function spawnAt(center: LatLng, car?: Car): WorldVehicle {
  const domain: Domain = car ? (car.domain ?? "road") : "road";
  const used = car ?? randomCarOf(domain);
  const dest = destFor(center, domain, used.type);
  const to: LatLng = [dest[0], dest[1]];
  return {
    id: `WV-${Date.now()}-${rnd(1e6)}`,
    car: used,
    domain,
    from: center,
    to,
    fromName: "here",
    toName: dest[2],
    legLen: Math.max(0.5, degDist(center, to)),
    t: 0,
    pos: center,
    heading: bearing(center, to),
    speedDeg: speedFor(used.type) * (0.7 + Math.random() * 0.6),
    cargo: cargoFor(used),
  };
}
