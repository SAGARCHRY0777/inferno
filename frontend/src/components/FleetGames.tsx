import L from "leaflet";
import { Fragment, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Circle, Marker, Polyline, useMap, useMapEvents } from "react-leaflet";

import { bearing, formatKm, type LatLng, routeThrough } from "@/lib/fleet";
import { distM, pathDist, randomPointNear, tspBest } from "@/lib/games";
import { type Place, searchPlaces } from "@/lib/geocode";

type Mode = "dispatch" | "tsp" | "intercept";

const TICK = 80;
const CATCH_M = 170;
const PLAYER = "#3DDC97"; // green = you
const ENEMY = "#FF4D6D"; // red = target
const GOLD = "#FFB020";

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
function car(heading: number, color: string): L.DivIcon {
  return L.divIcon({
    className: "av-marker",
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    html: `<div style="transform:rotate(${heading}deg);filter:drop-shadow(0 0 6px ${color})">
      <svg width="22" height="22" viewBox="0 0 16 16"><path d="M8 0.5 L13.5 14.5 L8 11 L2.5 14.5 Z"
      fill="${color}" stroke="#0A0B0F" stroke-width="0.7"/></svg></div>`,
  });
}

// --- a road-following driver (player vehicle) ------------------------------ //
interface Driver {
  route: LatLng[];
  t: number;
  speed: number;
  pos: LatLng;
  heading: number;
}
function makeDriver(route: LatLng[]): Driver {
  const meters = pathDist(route);
  const durMs = Math.min(12000, Math.max(2200, meters / 0.5));
  return {
    route,
    t: 0,
    speed: TICK / durMs,
    pos: route[0],
    heading: route.length > 1 ? bearing(route[0], route[1]) : 0,
  };
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

// --- a straight-line mover (chase targets — no OSRM, so no rate-limit spam) - //
interface Mover {
  pos: LatLng;
  dest: LatLng;
  heading: number;
}
function newMover(center: LatLng): Mover {
  const pos = randomPointNear(center, 3);
  const dest = randomPointNear(center, 3);
  return { pos, dest, heading: bearing(pos, dest) };
}
function stepMover(m: Mover, center: LatLng, mps: number): Mover {
  const d = distM(m.pos, m.dest);
  if (d < 40) {
    const dest = randomPointNear(center, 3);
    return { ...m, dest, heading: bearing(m.pos, dest) };
  }
  const step = (mps * TICK) / 1000;
  const f = Math.min(1, step / d);
  return {
    pos: [m.pos[0] + (m.dest[0] - m.pos[0]) * f, m.pos[1] + (m.dest[1] - m.pos[1]) * f],
    dest: m.dest,
    heading: bearing(m.pos, m.dest),
  };
}

async function geom(points: LatLng[]): Promise<LatLng[]> {
  const plan = await routeThrough(points);
  return plan && plan.geometry.length > 1 ? plan.geometry : points;
}

// --- intercept difficulty: 20 escalating levels --------------------------- //
function levelCfg(level: number) {
  return {
    nTargets: Math.min(1 + Math.floor((level - 1) / 4), 5), // 1 → 5 simultaneous
    speedMps: 150 + (level - 1) * 22, // faster every level
    timeS: Math.max(18, 40 - level), // tighter every level
    goal: level + 1, // catches needed to clear
  };
}

interface Order {
  id: number;
  pickup: LatLng;
  dropoff: LatLng;
  reward: number;
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

  useEffect(() => onActive?.(mode !== null), [mode, onActive]);

  // player vehicle (dispatch + intercept) — driven via refs to avoid setState races
  const [player, setPlayer] = useState<Driver | null>(null);
  const playerRef = useRef<Driver | null>(null);
  const arriveRef = useRef<(() => void) | null>(null);
  const setPv = (d: Driver | null) => {
    playerRef.current = d;
    setPlayer(d);
  };

  // dispatch
  const [orders, setOrders] = useState<Order[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const orderId = useRef(0);
  const spawnAcc = useRef(0);
  const timeAcc = useRef(0);

  // intercept
  const [targets, setTargets] = useState<Mover[]>([]);
  const targetsRef = useRef<Mover[]>([]);
  const setTg = (m: Mover[]) => {
    targetsRef.current = m;
    setTargets(m);
  };
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

  // location search (choose where to play)
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

  // --- intercept level control -------------------------------------------- //
  const startLevel = (lvl: number) => {
    levelRef.current = lvl;
    caughtRef.current = 0;
    setLevel(lvl);
    setCaught(0);
    const cfg = levelCfg(lvl);
    setTimeLeft(cfg.timeS);
    timeAcc.current = 0;
    setTg(Array.from({ length: cfg.nTargets }, () => newMover(centerRef.current)));
  };

  const startMode = (m: Mode) => {
    reset();
    setMode(m);
    setScore(0);
    centerRef.current = center();
    if (m === "dispatch") {
      setTimeLeft(60);
      timeAcc.current = 0;
      spawnAcc.current = 0;
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

  // --- dispatch: go to pickup → prepare → deliver ------------------------- //
  const dispatch = async (o: Order) => {
    if (busy || !running) return;
    setBusy(true);
    setStatus("🚗 heading to pickup");
    const from = playerRef.current?.pos ?? center();
    setPv(makeDriver(await geom([from, o.pickup])));
    arriveRef.current = () => {
      setStatus("🍳 preparing order…");
      window.setTimeout(async () => {
        setStatus("📦 delivering");
        setPv(makeDriver(await geom([o.pickup, o.dropoff])));
        arriveRef.current = () => {
          setScore((s) => s + o.reward);
          setOrders((os) => os.filter((x) => x.id !== o.id));
          setStatus("✅ delivered!");
          setBusy(false);
          window.setTimeout(() => setStatus(""), 1200);
        };
      }, 1100);
    };
  };

  // --- intercept: click the map to send your car -------------------------- //
  useMapEvents({
    async click(e) {
      if (mode !== "intercept" || !running || !playerRef.current) return;
      setPv(makeDriver(await geom([playerRef.current.pos, [e.latlng.lat, e.latlng.lng]])));
      arriveRef.current = null;
    },
  });

  // --- the single game loop (all logic in the interval body, not in updaters) //
  useEffect(() => {
    if (!mode || !running || mode === "tsp") return;
    const id = window.setInterval(() => {
      // 1s timer
      timeAcc.current += TICK;
      if (timeAcc.current >= 1000) {
        timeAcc.current -= 1000;
        setTimeLeft((s) => {
          if (s <= 1) {
            setRunning(false);
            if (mode === "intercept") setBanner(`Game over — reached level ${levelRef.current}`);
            return 0;
          }
          return s - 1;
        });
      }

      // advance the player vehicle (and fire arrival callbacks safely)
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
        const cfg = levelCfg(levelRef.current);
        const c = centerRef.current;
        const pos = playerRef.current?.pos;
        let nts = targetsRef.current.map((m) => stepMover(m, c, cfg.speedMps));
        let got = 0;
        if (pos) {
          nts = nts.map((m) => {
            if (distM(pos, m.pos) < CATCH_M) {
              got++;
              return newMover(c);
            }
            return m;
          });
        }
        setTg(nts);
        if (got > 0) {
          caughtRef.current += got;
          setCaught(caughtRef.current);
          setScore((s) => s + got);
          if (caughtRef.current >= cfg.goal) {
            const next = levelRef.current + 1;
            if (next > 20) {
              setRunning(false);
              setBanner("🏆 You cleared all 20 levels!");
            } else {
              setBanner(`Level ${next}! faster + more targets`);
              window.setTimeout(() => setBanner(""), 1600);
              startLevel(next);
            }
          }
        }
      }
    }, TICK);
    return () => window.clearInterval(id);
  }, [mode, running]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- tsp ----------------------------------------------------------------- //
  const pickStop = (i: number) => {
    if (mode !== "tsp" || tsp) return;
    setPicked((p) => (p.includes(i) ? p : [...p, i]));
  };
  const submitTsp = () => {
    if (picked.length !== stops.length) return;
    const your = pathDist(picked.map((i) => stops[i]));
    const best = tspBest(stops).dist;
    setTsp({ your, best, pct: Math.round((best / your) * 100) });
  };

  // --- location search ----------------------------------------------------- //
  useEffect(() => {
    if (q.trim().length < 3) {
      setPlaces([]);
      return;
    }
    const ctrl = new AbortController();
    const t = window.setTimeout(() => {
      void searchPlaces(q, ctrl.signal).then(setPlaces);
    }, 300);
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
  // map layers
  // ======================================================================== //
  const layers = (
    <>
      {mode === "dispatch" &&
        orders.map((o) => (
          <Fragment key={o.id}>
            <Marker position={o.pickup} icon={pin(GOLD, "📦")} />
            <Marker position={o.dropoff} icon={pin(PLAYER, "🏁")} />
            <Polyline
              positions={[o.pickup, o.dropoff]}
              pathOptions={{ color: GOLD, weight: 1, opacity: 0.4, dashArray: "4 6" }}
            />
          </Fragment>
        ))}

      {mode === "tsp" &&
        stops.map((s, i) => (
          <Marker
            key={`s-${i}`}
            position={s}
            icon={pin(
              i === 0 ? "#00E5FF" : picked.includes(i) ? PLAYER : ENEMY,
              i === 0 ? "S" : picked.includes(i) ? String(picked.indexOf(i)) : "",
              26,
            )}
            eventHandlers={{ click: () => pickStop(i) }}
          />
        ))}
      {mode === "tsp" && picked.length > 1 && (
        <Polyline positions={picked.map((i) => stops[i])} pathOptions={{ color: PLAYER, weight: 3, opacity: 0.85 }} />
      )}

      {mode === "intercept" &&
        targets.map((m, i) => (
          <Fragment key={`t-${i}`}>
            <Circle center={m.pos} radius={CATCH_M} pathOptions={{ color: ENEMY, weight: 1, opacity: 0.45 }} />
            <Marker position={m.pos} icon={car(m.heading, ENEMY)} />
          </Fragment>
        ))}

      {player && player.route.length > 1 && (
        <Polyline positions={player.route} pathOptions={{ color: PLAYER, weight: 3, opacity: 0.45 }} />
      )}
      {player && <Marker position={player.pos} icon={car(player.heading, mode === "dispatch" && busy ? GOLD : PLAYER)} />}
    </>
  );

  // ======================================================================== //
  // HUD
  // ======================================================================== //
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
          {/* choose where to play */}
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
                  <li
                    key={`${p.lat}-${i}`}
                    onClick={() => flyTo(p)}
                    className="cursor-pointer px-2.5 py-1.5 text-[11px] text-ink-muted hover:bg-surface-hover"
                  >
                    {p.label}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <p className="text-[10px] text-ink-faint">Pick a place, then a game — the fleet hides automatically.</p>
          <button onClick={() => startMode("dispatch")} className={BTN}>🚕 Dispatch — deliver before the clock</button>
          <button onClick={() => startMode("tsp")} className={BTN}>🧭 Route Rush — find the shortest loop</button>
          <button onClick={() => startMode("intercept")} className={BTN}>🎯 Intercept — 20-level chase</button>
        </div>
      )}

      {banner && <div className="rounded-lg bg-accent/15 px-2 py-1 text-center text-[11px] font-semibold text-accent">{banner}</div>}

      {mode && mode !== "tsp" && (
        <div className="flex items-center justify-between text-xs">
          <span className="tnum text-accent">score {score}</span>
          <span className={`tnum ${timeLeft <= 10 ? "text-danger" : "text-ink-muted"}`}>⏱ {timeLeft}s</span>
        </div>
      )}

      {mode === "intercept" && running && (
        <div className="flex items-center justify-between text-[11px] text-ink-muted">
          <span>Level <b className="text-accent">{level}</b>/20</span>
          <span className="tnum">caught {caught}/{levelCfg(level).goal}</span>
        </div>
      )}

      {mode === "dispatch" && (
        <div className="flex flex-col gap-1.5">
          {!running && <button onClick={() => startMode("dispatch")} className={BTN}>↻ Play again — final score {score}</button>}
          {running && orders.length === 0 && <p className="text-[11px] text-ink-faint">Waiting for orders…</p>}
          {orders.map((o) => (
            <button
              key={o.id}
              onClick={() => void dispatch(o)}
              disabled={busy}
              className="flex items-center justify-between rounded-lg border border-hairline bg-surface/50 px-2 py-1.5 text-[11px] hover:bg-surface-hover disabled:opacity-40"
            >
              <span>📦 {formatKm(distM(o.pickup, o.dropoff))}</span>
              <span className="tnum text-accent">+{o.reward}</span>
            </button>
          ))}
          {status && <p className="text-[11px] font-medium text-accent">{status}</p>}
        </div>
      )}

      {mode === "intercept" && (
        <p className="text-[11px] text-ink-faint">
          {running ? "Click the map to chase the red cars into your ring." : "Game over."}
          {!running && (
            <button onClick={() => startMode("intercept")} className={`${BTN} mt-1 w-full text-center`}>↻ Restart at level 1</button>
          )}
        </p>
      )}

      {mode === "tsp" && (
        <div className="flex flex-col gap-1.5">
          {!tsp ? (
            <>
              <p className="text-[11px] text-ink-faint">
                From <b>S</b>, click the red stops in the order you'd visit them — shortest loop wins.
              </p>
              <button onClick={submitTsp} disabled={picked.length !== stops.length} className={`${BTN} disabled:opacity-40`}>
                Submit ({picked.length}/{stops.length})
              </button>
            </>
          ) : (
            <>
              <div className="rounded-lg border border-hairline bg-surface/40 p-2 text-[11px]">
                <div className="flex justify-between"><span>Your route</span><span className="tnum">{formatKm(tsp.your)}</span></div>
                <div className="flex justify-between"><span>Best possible</span><span className="tnum text-accent">{formatKm(tsp.best)}</span></div>
                <div className="mt-1 text-center text-sm font-bold text-accent">{tsp.pct}% efficient</div>
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
