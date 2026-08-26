import L from "leaflet";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Circle, Marker, Polyline, useMap, useMapEvents } from "react-leaflet";

import {
  type Car,
  CARS,
  carDisplay,
  categoryLabel,
  categoryOf,
  iconOf,
} from "@/lib/cars";
import { bearing, formatKm, type LatLng, routeThrough } from "@/lib/fleet";
import {
  isPlayable,
  PLAYABLE_CATEGORIES,
  stars,
  statsFor,
} from "@/lib/vehicleStats";
import { distM, pathDist, randomPointNear, tspBest } from "@/lib/games";
import { type Place, searchPlaces } from "@/lib/geocode";
import { sound } from "@/lib/sound";

type Mode = "dispatch" | "tsp" | "intercept";

const TICK = 80;
const CATCH_M = 170;
const PLAYER = "#3DDC97"; // green = you
const ENEMY = "#FF4D6D"; // red = target
const GOLD = "#FFB020";

// high scores (per game) in localStorage
// Only road vehicles are playable: every mode routes over OSRM's driving
// profile, so a ship or airliner has no drivable path (see lib/vehicleStats).
const PLAYABLE: Car[] = CARS.filter(isPlayable);
const RIDE_KEY = "inferno.ride";

const hiKey = (m: string) => `inferno.hi.${m}`;
const getHi = (m: string): number => {
  try {
    return Number(localStorage.getItem(hiKey(m))) || 0;
  } catch {
    return 0;
  }
};
const saveHi = (m: string, v: number): number => {
  const best = Math.max(getHi(m), v);
  try {
    localStorage.setItem(hiKey(m), String(best));
  } catch {
    /* ignore */
  }
  return best;
};

// --- icons ----------------------------------------------------------------- //
function pin(color: string, label = "", size = 22): L.DivIcon {
  return L.divIcon({
    className: "",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};
      color:#0A0B0F;font:700 ${Math.round(size * 0.5)}px/${size}px ui-sans-serif;text-align:center;
      box-shadow:0 0 12px ${color};border:2px solid #0A0B0F;cursor:pointer">${label}</div>`,
  });
}
function car(heading: number, color: string, glyph?: string): L.DivIcon {
  // The arrow still carries the heading (so you can read where you're going);
  // the chosen vehicle's emoji rides on top so your pick is visible on the map.
  const badge = glyph
    ? `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
        font-size:11px;line-height:1;pointer-events:none">${glyph}</div>`
    : "";
  return L.divIcon({
    className: "av-marker",
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    html: `<div style="position:relative;width:26px;height:26px">
      <div style="transform:rotate(${heading}deg);filter:drop-shadow(0 0 6px ${color})">
        <svg width="26" height="26" viewBox="0 0 16 16"><path d="M8 0.5 L13.5 14.5 L8 11 L2.5 14.5 Z"
        fill="${color}" stroke="#0A0B0F" stroke-width="0.7"/></svg></div>
      ${badge}</div>`,
  });
}

// --- a road-following driver ----------------------------------------------- //
interface Driver {
  route: LatLng[];
  t: number;
  speed: number;
  pos: LatLng;
  heading: number;
}
function makeDriver(route: LatLng[], speedMul = 1): Driver {
  const meters = pathDist(route);
  const durMs = Math.min(16000, Math.max(2200, meters / 0.5));
  return {
    route,
    t: 0,
    speed: (TICK / durMs) * speedMul,
    pos: route[0],
    heading: route.length > 1 ? bearing(route[0], route[1]) : 0,
  };
}
function still(pos: LatLng): Driver {
  return { route: [pos, pos], t: 1, speed: 0, pos, heading: 0 };
}
function advance(d: Driver): Driver {
  const t = Math.min(1, d.t + d.speed);
  const f = t * (d.route.length - 1);
  const i = Math.min(Math.floor(f), d.route.length - 2);
  const a = d.route[i];
  const b = d.route[i + 1];
  const frac = f - i;
  return {
    ...d,
    t,
    pos: [a[0] + (b[0] - a[0]) * frac, a[1] + (b[1] - a[1]) * frac],
    heading: bearing(a, b),
  };
}

async function geom(points: LatLng[]): Promise<LatLng[]> {
  const plan = await routeThrough(points);
  return plan && plan.geometry.length > 1 ? plan.geometry : points;
}

// intercept: 20 escalating levels
function levelCfg(level: number) {
  return {
    nTargets: Math.min(1 + Math.floor((level - 1) / 4), 5),
    speedMul: 1 + (level - 1) * 0.13,
    timeS: Math.max(18, 40 - level),
    goal: level + 1,
  };
}

interface Order {
  id: number;
  pickup: LatLng;
  dropoff: LatLng;
  reward: number;
}
interface Tgt {
  drv: Driver;
  regen: boolean;
}

export function FleetGames({
  hud,
  onActive,
}: {
  hud: HTMLElement | null;
  onActive?: (active: boolean) => void;
}) {
  const map = useMap();
  const [mode, setMode] = useState<Mode | null>(null);
  const [running, setRunning] = useState(false);
  const [timeLeft, setTimeLeft] = useState(0);
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(0);
  const scoreRef = useRef(0);

  // --- garage: the vehicle you drive, and what it changes ------------------ //
  // Persisted so your pick survives a reload; falls back to the first playable
  // car if the stored one was renamed or removed from the catalogue.
  const [ride, setRide] = useState<Car>(() => {
    try {
      const saved = localStorage.getItem(RIDE_KEY);
      if (saved) {
        const hit = PLAYABLE.find((c) => `${c.brand} ${c.model}` === saved);
        if (hit) return hit;
      }
    } catch {
      /* private mode / storage blocked */
    }
    return PLAYABLE[0];
  });
  const [garageOpen, setGarageOpen] = useState(false);
  const [garageCat, setGarageCat] = useState<string>("");
  const rideStats = useMemo(() => statsFor(ride), [ride]);
  // Read inside timers/callbacks so a mid-game swap can't be captured stale.
  const rideRef = useRef(ride);
  rideRef.current = ride;
  const speedMul = () => statsFor(rideRef.current).speedMul;

  const chooseRide = (c: Car) => {
    setRide(c);
    setGarageOpen(false);
    try {
      localStorage.setItem(RIDE_KEY, `${c.brand} ${c.model}`);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => onActive?.(mode !== null), [mode, onActive]);

  const bumpScore = (n: number) => {
    scoreRef.current += n;
    setScore(scoreRef.current);
  };
  /** Payout for a delivery, scaled by the vehicle's reward multiplier. */
  const payout = (base: number) => Math.max(1, Math.round(base * statsFor(rideRef.current).rewardMul));

  // player vehicle (dispatch + intercept), driven via refs (no setState races)
  const [player, setPlayer] = useState<Driver | null>(null);
  const playerRef = useRef<Driver | null>(null);
  const arriveRef = useRef<(() => void) | null>(null);
  // Every setTimeout scheduled by the games is registered here and cleared on
  // unmount. Without it, closing Fleet Command (Esc) mid-delivery still fired the
  // 1.1s/1.2s/1.6s callbacks against an unmounted component — setting state and,
  // worse, kicking off a pointless OSRM geometry request.
  const timersRef = useRef<number[]>([]);
  const later = (fn: () => void, ms: number) => {
    const id = window.setTimeout(fn, ms);
    timersRef.current.push(id);
    return id;
  };
  useEffect(() => {
    const timers = timersRef;
    return () => {
      timers.current.forEach(window.clearTimeout);
      timers.current = [];
    };
  }, []);
  const setPv = (d: Driver | null) => {
    playerRef.current = d;
    setPlayer(d);
  };

  // dispatch
  const [orders, setOrders] = useState<Order[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const orderId = useRef(0);
  const timeAcc = useRef(0);

  // intercept
  const [targets, setTargets] = useState<Tgt[]>([]);
  const targetsRef = useRef<Tgt[]>([]);
  const setTg = (m: Tgt[]) => {
    targetsRef.current = m;
    setTargets(m);
  };
  const speedMulRef = useRef(1);
  const [level, setLevel] = useState(1);
  const [caught, setCaught] = useState(0);
  const [banner, setBanner] = useState("");
  const centerRef = useRef<LatLng>([0, 0]);
  const levelRef = useRef(1);
  const caughtRef = useRef(0);

  // tsp
  const [stops, setStops] = useState<LatLng[]>([]);
  const [picked, setPicked] = useState<number[]>([]);
  const [tsp, setTsp] = useState<{ your: number; best: number; pct: number } | null>(null);
  const [tspLoading, setTspLoading] = useState(false);

  // location search
  const [q, setQ] = useState("");
  const [places, setPlaces] = useState<Place[]>([]);

  const center = (): LatLng => {
    const c = map.getCenter();
    return [c.lat, c.lng];
  };

  const BTN =
    "focusable rounded-lg border border-hairline px-2 py-1.5 text-left text-[11px] text-ink-muted hover:bg-surface-hover";

  const reset = () => {
    setRunning(false);
    setPv(null);
    arriveRef.current = null;
    setTg([]);
    setOrders([]);
    setBusy(false);
    setStatus("");
    setPicked([]);
    setTsp(null);
    setBanner("");
  };

  // road route for a target (reads its current position so there's no jump)
  const regenTgt = (i: number) => {
    const c = centerRef.current;
    const mul = speedMulRef.current;
    const from = targetsRef.current[i]?.drv.pos ?? c;
    void geom([from, randomPointNear(c, 3), randomPointNear(c, 3)]).then((g) => {
      const arr = targetsRef.current.slice();
      if (arr[i]) {
        arr[i] = { drv: makeDriver(g, mul), regen: false };
        setTg(arr);
      }
    });
  };

  const startLevel = (lvl: number) => {
    const cfg = levelCfg(lvl);
    levelRef.current = lvl;
    caughtRef.current = 0;
    speedMulRef.current = cfg.speedMul;
    setLevel(lvl);
    setCaught(0);
    setTimeLeft(cfg.timeS);
    timeAcc.current = 0;
    const seed = Array.from({ length: cfg.nTargets }, () => still(randomPointNear(centerRef.current, 3)));
    setTg(seed.map((drv) => ({ drv, regen: true })));
    seed.forEach((_, i) => regenTgt(i)); // upgrade each to a real road route
  };

  const startMode = (m: Mode) => {
    reset();
    setMode(m);
    scoreRef.current = 0;
    setScore(0);
    setBest(getHi(m));
    centerRef.current = center();
    if (m === "dispatch") {
      setTimeLeft(60);
      timeAcc.current = 0;
      setRunning(true);
    } else if (m === "intercept") {
      setPv(makeDriver([center(), center()]));
      setRunning(true);
      startLevel(1);
    } else {
      const c = center();
      setStops([c, ...Array.from({ length: 5 }, () => randomPointNear(c, 2.2))]);
      setPicked([0]);
      setTimeLeft(0);
    }
  };

  // dispatch
  const dispatch = async (o: Order) => {
    if (busy || !running) return;
    sound.blip();
    setBusy(true);
    setStatus("🚗 heading to pickup");
    const from = playerRef.current?.pos ?? center();
    setPv(makeDriver(await geom([from, o.pickup]), speedMul()));
    arriveRef.current = () => {
      setStatus("🍳 preparing order…");
      later(async () => {
        setStatus("📦 delivering");
        setPv(makeDriver(await geom([o.pickup, o.dropoff]), speedMul()));
        arriveRef.current = () => {
          bumpScore(payout(o.reward));
          sound.deliver();
          setOrders((os) => os.filter((x) => x.id !== o.id));
          setStatus("✅ delivered!");
          setBusy(false);
          later(() => setStatus(""), 1200);
        };
      }, 1100);
    };
  };

  // intercept: click to send your car
  useMapEvents({
    async click(e) {
      if (mode !== "intercept" || !running || !playerRef.current) return;
      sound.blip();
      setPv(makeDriver(await geom([playerRef.current.pos, [e.latlng.lat, e.latlng.lng]]), speedMul()));
      arriveRef.current = null;
    },
  });

  // main game loop
  useEffect(() => {
    if (!mode || !running || mode === "tsp") return;
    const id = window.setInterval(() => {
      timeAcc.current += TICK;
      if (timeAcc.current >= 1000) {
        timeAcc.current -= 1000;
        setTimeLeft((s) => {
          if (s <= 1) {
            setRunning(false);
            setBest(saveHi(mode, scoreRef.current));
            sound.gameover();
            if (mode === "intercept") setBanner(`Game over — reached level ${levelRef.current}`);
            return 0;
          }
          return s - 1;
        });
      }

      // player
      const p = playerRef.current;
      if (p) {
        if (p.t >= 1) {
          const cb = arriveRef.current;
          if (cb) {
            arriveRef.current = null;
            cb();
          }
        } else {
          setPv(advance(p));
        }
      }

      if (mode === "dispatch") {
        setOrders((os) => {
          if (os.length >= 3 || Math.random() > 0.05) return os;
          const c = centerRef.current;
          const pickup = randomPointNear(c, 2.2);
          const dropoff = randomPointNear(c, 2.6);
          return [
            ...os,
            { id: ++orderId.current, pickup, dropoff, reward: Math.max(10, Math.round(distM(pickup, dropoff) / 100)) },
          ];
        });
      }

      if (mode === "intercept") {
        const c = centerRef.current;
        const pos = playerRef.current?.pos;
        const toRegen: number[] = [];
        let got = 0;
        const next = targetsRef.current.map((tg, i) => {
          if (pos && distM(pos, tg.drv.pos) < CATCH_M) {
            got++;
            toRegen.push(i);
            return { drv: still(randomPointNear(c, 4)), regen: true }; // respawn far
          }
          if (tg.drv.t >= 1) {
            if (!tg.regen) toRegen.push(i);
            return { ...tg, regen: true };
          }
          return { drv: advance(tg.drv), regen: tg.regen };
        });
        targetsRef.current = next;
        setTargets(next);
        toRegen.forEach((i) => regenTgt(i));

        if (got > 0) {
          sound.caught();
          bumpScore(got);
          caughtRef.current += got;
          setCaught(caughtRef.current);
          if (caughtRef.current >= levelCfg(levelRef.current).goal) {
            const nextLvl = levelRef.current + 1;
            if (nextLvl > 20) {
              setRunning(false);
              setBest(saveHi("intercept", scoreRef.current));
              setBanner("🏆 You cleared all 20 levels!");
            } else {
              sound.levelup();
              setBanner(`Level ${nextLvl}! faster + more targets`);
              later(() => setBanner(""), 1600);
              startLevel(nextLvl);
            }
          }
        }
      }
    }, TICK);
    return () => window.clearInterval(id);
  }, [mode, running]); // eslint-disable-line react-hooks/exhaustive-deps

  // tsp
  const pickStop = (i: number) => {
    if (mode !== "tsp" || tsp) return;
    sound.blip();
    setPicked((pp) => (pp.includes(i) ? pp : [...pp, i]));
  };
  const submitTsp = async () => {
    if (picked.length !== stops.length || tspLoading) return;
    setTspLoading(true);
    const yourStops = picked.map((i) => stops[i]);
    const bestStops = tspBest(stops).order.map((i) => stops[i]);
    // Real ROAD distance via OSRM for both routes (straight-line fallback).
    const [yp, bp] = await Promise.all([routeThrough(yourStops), routeThrough(bestStops)]);
    const your = yp ? yp.distanceM : pathDist(yourStops);
    const bestDist = bp ? bp.distanceM : pathDist(bestStops);
    const pct = Math.min(100, Math.round((bestDist / your) * 100));
    setTsp({ your, best: bestDist, pct });
    setBest(saveHi("tsp", pct));
    setTspLoading(false);
    sound.success();
  };

  // location search
  useEffect(() => {
    if (q.trim().length < 3) {
      setPlaces([]);
      return;
    }
    const ctrl = new AbortController();
    const t = window.setTimeout(() => void searchPlaces(q, ctrl.signal).then(setPlaces), 300);
    return () => {
      ctrl.abort();
      window.clearTimeout(t);
    };
  }, [q]);
  const flyTo = (p: Place) => {
    map.flyTo([p.lat, p.lng], 14);
    setQ(p.label);
    setPlaces([]);
  };

  // ======================================================================== //
  const layers = (
    <>
      {mode === "dispatch" &&
        orders.map((o) => (
          <Fragment key={o.id}>
            <Marker position={o.pickup} icon={pin(GOLD, "📦")} />
            <Marker position={o.dropoff} icon={pin(PLAYER, "🏁")} />
            <Polyline positions={[o.pickup, o.dropoff]} pathOptions={{ color: GOLD, weight: 1, opacity: 0.4, dashArray: "4 6" }} />
          </Fragment>
        ))}

      {mode === "tsp" &&
        stops.map((s, i) => (
          <Marker
            key={`s-${i}`}
            position={s}
            icon={pin(i === 0 ? "#00E5FF" : picked.includes(i) ? PLAYER : ENEMY, i === 0 ? "S" : picked.includes(i) ? String(picked.indexOf(i)) : "", 26)}
            eventHandlers={{ click: () => pickStop(i) }}
          />
        ))}
      {mode === "tsp" && picked.length > 1 && (
        <Polyline positions={picked.map((i) => stops[i])} pathOptions={{ color: PLAYER, weight: 3, opacity: 0.85 }} />
      )}

      {mode === "intercept" &&
        targets.map((tg, i) => (
          <Fragment key={`t-${i}`}>
            <Circle center={tg.drv.pos} radius={CATCH_M} pathOptions={{ color: ENEMY, weight: 1, opacity: 0.45 }} />
            <Marker position={tg.drv.pos} icon={car(tg.drv.heading, ENEMY)} />
          </Fragment>
        ))}

      {player && player.route.length > 1 && (
        <Polyline positions={player.route} pathOptions={{ color: PLAYER, weight: 3, opacity: 0.45 }} />
      )}
      {player && (
        <Marker
          position={player.pos}
          icon={car(player.heading, mode === "dispatch" && busy ? GOLD : PLAYER, iconOf(ride))}
        />
      )}
    </>
  );

  const hudUi = (
    <div className="glass-raised flex w-64 flex-col gap-2 p-4">
      <div className="flex items-center justify-between">
        <span className="label-eyebrow">Arcade</span>
        {mode && (
          <button
            onClick={() => {
              reset();
              setMode(null);
            }}
            className="focusable rounded-md border border-hairline px-2 py-0.5 text-[10px] text-ink-muted hover:border-danger/50 hover:text-danger"
          >
            ✕ Exit game
          </button>
        )}
      </div>

      {!mode && (
        <div className="flex flex-col gap-1.5">
          <div className="relative">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="🌍 play in… (any city/place)"
              className="focusable w-full rounded-lg border border-hairline bg-surface/60 px-2.5 py-1.5 text-[11px] text-ink placeholder:text-ink-faint"
            />
            {places.length > 0 && (
              <ul className="absolute z-[1100] mt-1 max-h-44 w-full overflow-auto rounded-lg border border-hairline bg-base shadow-xl">
                {places.map((p, i) => (
                  <li key={`${p.lat}-${i}`} onClick={() => flyTo(p)} className="cursor-pointer px-2.5 py-1.5 text-[11px] text-ink-muted hover:bg-surface-hover">
                    {p.label}
                  </li>
                ))}
              </ul>
            )}
          </div>
          {/* --- garage ------------------------------------------------- */}
          <button
            onClick={() => setGarageOpen((o) => !o)}
            className="focusable flex items-center justify-between rounded-lg border border-hairline bg-surface/50 px-2 py-1.5 text-left text-[11px] hover:bg-surface-hover"
          >
            <span className="truncate">
              <span className="mr-1">{iconOf(ride)}</span>
              <b className="text-ink">{ride.brand}</b>{" "}
              <span className="text-ink-muted">{ride.model}</span>
            </span>
            <span className="ml-2 shrink-0 text-ink-faint">{garageOpen ? "▲" : "garage ▾"}</span>
          </button>
          <div className="flex items-center justify-between rounded-lg border border-hairline bg-surface/30 px-2 py-1 text-[10px] text-ink-muted">
            <span>
              speed <span className="text-accent">{stars(rideStats.speedMul, 1.6)}</span>
            </span>
            <span>
              payout <span className="text-accent">{stars(rideStats.rewardMul, 2.5)}</span>
            </span>
            <span className="tnum text-ink-faint">×{rideStats.rewardMul.toFixed(2)}</span>
          </div>
          {garageOpen && (
            <div className="flex flex-col gap-1 rounded-lg border border-hairline bg-surface/40 p-2">
              <p className="text-[10px] leading-snug text-ink-faint">
                {rideStats.blurb} Road vehicles only — every course is routed on real roads.
              </p>
              <div className="flex flex-wrap gap-1">
                <button
                  onClick={() => setGarageCat("")}
                  className={`focusable rounded-full border px-1.5 py-0.5 text-[10px] ${
                    garageCat === "" ? "border-accent/60 bg-accent/15 text-ink" : "border-hairline text-ink-muted"
                  }`}
                >
                  All
                </button>
                {PLAYABLE_CATEGORIES.map((c) => (
                  <button
                    key={c}
                    onClick={() => setGarageCat(c)}
                    className={`focusable rounded-full border px-1.5 py-0.5 text-[10px] ${
                      garageCat === c ? "border-accent/60 bg-accent/15 text-ink" : "border-hairline text-ink-muted"
                    }`}
                  >
                    {categoryLabel(c)}
                  </button>
                ))}
              </div>
              <ul className="flex max-h-40 flex-col gap-0.5 overflow-auto">
                {PLAYABLE.filter((c) => !garageCat || categoryOf(c) === garageCat).map((c, i) => {
                  const s = statsFor(c);
                  const active = c.brand === ride.brand && c.model === ride.model;
                  return (
                    <li key={`${c.brand}-${c.model}-${i}`}>
                      <button
                        onClick={() => chooseRide(c)}
                        className={`focusable flex w-full items-center justify-between rounded-md border px-1.5 py-1 text-[10px] hover:bg-surface-hover ${
                          active ? "border-accent/60 bg-accent/10 text-ink" : "border-transparent text-ink-muted"
                        }`}
                      >
                        <span className="truncate">
{carDisplay(c)}
                        </span>
                        <span className="ml-2 shrink-0 tabular-nums text-ink-faint">
                          {s.speedMul.toFixed(2)}× · {s.rewardMul.toFixed(1)}💰
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <button onClick={() => startMode("dispatch")} className={BTN}>🚕 Dispatch — deliver before the clock</button>
          <button onClick={() => startMode("tsp")} className={BTN}>🧭 Route Rush — shortest loop</button>
          <button onClick={() => startMode("intercept")} className={BTN}>🎯 Intercept — 20-level road chase</button>
        </div>
      )}

      {banner && <div className="rounded-lg bg-accent/15 px-2 py-1 text-center text-[11px] font-semibold text-accent">{banner}</div>}

      {mode && mode !== "tsp" && (
        <>
          <div className="flex items-center justify-between text-xs">
            <span className="tnum text-accent">score {score}</span>
            <span className="tnum text-ink-faint">best {best}</span>
            <span className={`tnum ${timeLeft <= 10 ? "text-danger" : "text-ink-muted"}`}>⏱ {timeLeft}s</span>
          </div>
          {/* Which vehicle is driving, and the two numbers that change play. */}
          <div className="flex items-center justify-between rounded-lg border border-hairline bg-surface/30 px-2 py-1 text-[10px] text-ink-muted">
            <span className="truncate">
              <span className="mr-1">{iconOf(ride)}</span>
              {ride.brand} {ride.model}
            </span>
            <span className="ml-2 shrink-0 tabular-nums">
              {rideStats.speedMul.toFixed(2)}× · {rideStats.rewardMul.toFixed(1)}💰
            </span>
          </div>
        </>
      )}

      {mode === "intercept" && running && (
        <div className="flex items-center justify-between text-[11px] text-ink-muted">
          <span>Level <b className="text-accent">{level}</b>/20</span>
          <span className="tnum">caught {caught}/{levelCfg(level).goal}</span>
        </div>
      )}

      {mode === "dispatch" && (
        <div className="flex flex-col gap-1.5">
          {!running && <button onClick={() => startMode("dispatch")} className={BTN}>↻ Play again — final {score}</button>}
          {running && orders.length === 0 && <p className="text-[11px] text-ink-faint">Waiting for orders…</p>}
          {orders.map((o) => (
            <button key={o.id} onClick={() => void dispatch(o)} disabled={busy} className="flex items-center justify-between rounded-lg border border-hairline bg-surface/50 px-2 py-1.5 text-[11px] hover:bg-surface-hover disabled:opacity-40">
              <span>📦 {formatKm(distM(o.pickup, o.dropoff))}</span>
              <span className="tnum text-accent">+{o.reward}</span>
            </button>
          ))}
          {status && <p className="text-[11px] font-medium text-accent">{status}</p>}
        </div>
      )}

      {mode === "intercept" && !running && (
        <button onClick={() => startMode("intercept")} className={`${BTN} text-center`}>↻ Restart at level 1</button>
      )}
      {mode === "intercept" && running && (
        <p className="text-[11px] text-ink-faint">Click the map to chase the red cars into your ring.</p>
      )}

      {mode === "tsp" && (
        <div className="flex flex-col gap-1.5">
          {!tsp ? (
            <>
              <p className="text-[11px] text-ink-faint">From <b>S</b>, click the red stops in your visiting order — shortest <b>road</b> route wins.</p>
              <button onClick={() => void submitTsp()} disabled={picked.length !== stops.length || tspLoading} className={`${BTN} disabled:opacity-40`}>
                {tspLoading ? "routing…" : `Submit (${picked.length}/${stops.length})`}
              </button>
            </>
          ) : (
            <>
              <div className="rounded-lg border border-hairline bg-surface/40 p-2 text-[11px]">
                <div className="flex justify-between"><span>Your route</span><span className="tnum">{formatKm(tsp.your)}</span></div>
                <div className="flex justify-between"><span>Best possible</span><span className="tnum text-accent">{formatKm(tsp.best)}</span></div>
                <div className="mt-1 text-center text-sm font-bold text-accent">{tsp.pct}% efficient · best {best}%</div>
              </div>
              <button onClick={() => startMode("tsp")} className={BTN}>↻ New puzzle</button>
            </>
          )}
        </div>
      )}
    </div>
  );

  return (
    <>
      {layers}
      {hud && createPortal(hudUi, hud)}
    </>
  );
}
