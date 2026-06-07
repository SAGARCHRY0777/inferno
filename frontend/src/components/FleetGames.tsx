import L from "leaflet";
import { Fragment, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Circle, Marker, Polyline, useMap, useMapEvents } from "react-leaflet";

import { bearing, formatKm, type LatLng, routeThrough } from "@/lib/fleet";
import { distM, pathDist, randomPointNear, tspBest } from "@/lib/games";

type Mode = "dispatch" | "tsp" | "intercept";

const TICK = 80;
const CATCH_M = 160;

// --- icons ----------------------------------------------------------------- //
function pin(color: string, label = "", size = 18): L.DivIcon {
  return L.divIcon({
    className: "",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};
      color:#0A0B0F;font:700 ${Math.round(size * 0.55)}px/${size}px ui-sans-serif;text-align:center;
      box-shadow:0 0 10px ${color};border:2px solid #0A0B0F">${label}</div>`,
  });
}
function car(heading: number, color: string): L.DivIcon {
  return L.divIcon({
    className: "av-marker",
    iconSize: [20, 20],
    iconAnchor: [10, 10],
    html: `<div style="transform:rotate(${heading}deg);filter:drop-shadow(0 0 6px ${color})">
      <svg width="20" height="20" viewBox="0 0 16 16"><path d="M8 0.5 L13.5 14.5 L8 11 L2.5 14.5 Z"
      fill="${color}" stroke="#0A0B0F" stroke-width="0.7"/></svg></div>`,
  });
}

// --- a vehicle driving a polyline at a game pace ---------------------------- //
interface Driver {
  route: LatLng[];
  t: number; // 0..1
  speed: number; // added to t per tick
  pos: LatLng;
  heading: number;
}
function makeDriver(route: LatLng[]): Driver {
  const meters = pathDist(route);
  const durMs = Math.min(14000, Math.max(2500, meters / 0.45));
  const head = route.length > 1 ? bearing(route[0], route[1]) : 0;
  return { route, t: 0, speed: TICK / durMs, pos: route[0], heading: head };
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

/** Route through points, falling back to straight segments so a game never stalls. */
async function geom(points: LatLng[]): Promise<LatLng[]> {
  const plan = await routeThrough(points);
  return plan && plan.geometry.length > 1 ? plan.geometry : points;
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

  // Tell the parent when a game is on, so it can hide/pause the fleet sim clutter.
  useEffect(() => {
    onActive?.(mode !== null);
  }, [mode, onActive]);
  const [running, setRunning] = useState(false);
  const [timeLeft, setTimeLeft] = useState(0);
  const [score, setScore] = useState(0);

  // shared player vehicle (dispatch + intercept)
  const [pv, setPv] = useState<Driver | null>(null);
  const onArrive = useRef<(() => void) | null>(null);

  // dispatch
  const [orders, setOrders] = useState<Order[]>([]);
  const [carrying, setCarrying] = useState(false);
  const [busy, setBusy] = useState(false);
  const orderId = useRef(0);
  const spawnAcc = useRef(0);

  // intercept
  const [target, setTarget] = useState<Driver | null>(null);

  // tsp
  const [stops, setStops] = useState<LatLng[]>([]);
  const [picked, setPicked] = useState<number[]>([]);
  const [tsp, setTsp] = useState<{ your: number; best: number; pct: number } | null>(null);

  const BTN =
    "focusable rounded-lg border border-hairline px-2 py-1.5 text-left text-[11px] text-ink-muted hover:bg-surface-hover";

  const center = (): LatLng => {
    const c = map.getCenter();
    return [c.lat, c.lng];
  };

  const reset = () => {
    setRunning(false);
    setPv(null);
    setTarget(null);
    setOrders([]);
    setCarrying(false);
    setBusy(false);
    setPicked([]);
    setTsp(null);
    onArrive.current = null;
  };

  const startMode = (m: Mode) => {
    reset();
    setMode(m);
    setScore(0);
    if (m === "dispatch") {
      setTimeLeft(60);
      setRunning(true);
      spawnAcc.current = 0;
    } else if (m === "intercept") {
      setTimeLeft(45);
      setRunning(true);
      setPv(makeDriver([center(), center()]));
      void geom([randomPointNear(center(), 2.5), randomPointNear(center(), 2.5)]).then((g) =>
        setTarget(makeDriver(g)),
      );
    } else {
      // tsp: place a depot + 5 destinations, no timer
      const c = center();
      setStops([c, ...Array.from({ length: 5 }, () => randomPointNear(c, 2.2))]);
      setPicked([0]);
      setTimeLeft(0);
    }
  };

  // --- dispatch: send the player to fulfil an order ------------------------ //
  const dispatch = async (o: Order) => {
    if (busy || !running) return;
    setBusy(true);
    setCarrying(false);
    const from = pv?.pos ?? center();
    const toPickup = await geom([from, o.pickup]);
    setPv(makeDriver(toPickup));
    onArrive.current = async () => {
      setCarrying(true);
      const toDrop = await geom([o.pickup, o.dropoff]);
      setPv(makeDriver(toDrop));
      onArrive.current = () => {
        setScore((s) => s + o.reward);
        setOrders((os) => os.filter((x) => x.id !== o.id));
        setCarrying(false);
        setBusy(false);
        onArrive.current = null;
      };
    };
  };

  // --- intercept: click the map to send the player there ------------------- //
  useMapEvents({
    async click(e) {
      if (mode !== "intercept" || !running || !pv) return;
      const dest: LatLng = [e.latlng.lat, e.latlng.lng];
      const g = await geom([pv.pos, dest]);
      setPv(makeDriver(g));
      onArrive.current = null;
    },
  });

  // --- the single game loop ------------------------------------------------ //
  useEffect(() => {
    if (!mode || !running) return;
    const id = window.setInterval(() => {
      // timers (dispatch + intercept)
      if (mode !== "tsp") {
        spawnAcc.current += TICK;
        if (spawnAcc.current >= 1000) {
          spawnAcc.current -= 1000;
          setTimeLeft((s) => {
            if (s <= 1) {
              setRunning(false);
              return 0;
            }
            return s - 1;
          });
        }
      }

      // advance the player vehicle
      setPv((d) => {
        if (!d) return d;
        if (d.t >= 1) {
          const cb = onArrive.current;
          if (cb) {
            onArrive.current = null;
            cb();
          }
          return d;
        }
        return advance(d);
      });

      if (mode === "dispatch") {
        // spawn orders up to a cap
        setOrders((os) => {
          if (os.length >= 3 || Math.random() > 0.06) return os;
          const c = center();
          const pickup = randomPointNear(c, 2.2);
          const dropoff = randomPointNear(c, 2.6);
          const reward = Math.max(10, Math.round(distM(pickup, dropoff) / 100));
          return [...os, { id: ++orderId.current, pickup, dropoff, reward }];
        });
      }

      if (mode === "intercept") {
        setTarget((t) => {
          if (!t) return t;
          if (t.t >= 1) {
            void geom([t.pos, randomPointNear(t.pos, 2.5)]).then((g) => setTarget(makeDriver(g)));
            return t;
          }
          return advance(t);
        });
      }
    }, TICK);
    return () => window.clearInterval(id);
  }, [mode, running]); // eslint-disable-line react-hooks/exhaustive-deps

  // catch detection for intercept (separate so it reads fresh pv/target)
  useEffect(() => {
    if (mode !== "intercept" || !running || !pv || !target) return;
    if (distM(pv.pos, target.pos) < CATCH_M) {
      setScore((s) => s + 1);
      // Move the target far away SYNCHRONOUSLY so the next ticks can't re-count the
      // same catch while the road route loads; then upgrade it to real roads.
      const a = randomPointNear(center(), 3);
      const b = randomPointNear(a, 2);
      setTarget(makeDriver([a, b]));
      void geom([a, b]).then((g) => setTarget(makeDriver(g)));
    }
  }, [mode, running, pv, target]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- tsp interactions ---------------------------------------------------- //
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

  // ======================================================================== //
  // Map layers for the active game
  // ======================================================================== //
  const layers = (
    <>
      {/* dispatch orders */}
      {mode === "dispatch" &&
        orders.map((o) => (
          <Fragment key={o.id}>
            <Marker position={o.pickup} icon={pin("#FFB020", "📦")} />
            <Marker position={o.dropoff} icon={pin("#3DDC97", "🏁")} />
            <Polyline
              positions={[o.pickup, o.dropoff]}
              pathOptions={{ color: "#FFB020", weight: 1, opacity: 0.4, dashArray: "4 6" }}
            />
          </Fragment>
        ))}

      {/* tsp stops + the player's chosen path */}
      {mode === "tsp" &&
        stops.map((s, i) => (
          <Marker
            key={`s-${i}`}
            position={s}
            icon={pin(
              i === 0 ? "#00E5FF" : picked.includes(i) ? "#3DDC97" : "#FF4D6D",
              i === 0 ? "S" : picked.includes(i) ? String(picked.indexOf(i)) : "",
            )}
            eventHandlers={{ click: () => pickStop(i) }}
          />
        ))}
      {mode === "tsp" && picked.length > 1 && (
        <Polyline
          positions={picked.map((i) => stops[i])}
          pathOptions={{ color: "#3DDC97", weight: 3, opacity: 0.85 }}
        />
      )}

      {/* intercept target */}
      {mode === "intercept" && target && (
        <>
          <Circle center={target.pos} radius={CATCH_M} pathOptions={{ color: "#FF4D6D", weight: 1, opacity: 0.5 }} />
          <Marker position={target.pos} icon={car(target.heading, "#FF4D6D")} />
        </>
      )}

      {/* shared player vehicle + its route */}
      {pv && pv.route.length > 1 && (
        <Polyline positions={pv.route} pathOptions={{ color: "#00E5FF", weight: 3, opacity: 0.5 }} />
      )}
      {pv && <Marker position={pv.pos} icon={car(pv.heading, carrying ? "#FFB020" : "#00E5FF")} />}
    </>
  );

  // ======================================================================== //
  // HUD (portaled into FleetMap's overlay container)
  // ======================================================================== //
  const hudUi = (
    <div className="glass-raised flex w-60 flex-col gap-2 p-4">
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
          <p className="text-[11px] text-ink-faint">Play a game on real roads — free, worldwide.</p>
          <button onClick={() => startMode("dispatch")} className={BTN}>🚕 Dispatch</button>
          <button onClick={() => startMode("tsp")} className={BTN}>🧭 Route Rush</button>
          <button onClick={() => startMode("intercept")} className={BTN}>🎯 Intercept</button>
        </div>
      )}

      {mode && mode !== "tsp" && (
        <div className="flex items-center justify-between text-xs">
          <span className="tnum text-accent">score {score}</span>
          <span className={`tnum ${timeLeft <= 10 ? "text-danger" : "text-ink-muted"}`}>⏱ {timeLeft}s</span>
        </div>
      )}

      {mode === "dispatch" && (
        <div className="flex flex-col gap-1.5">
          {!running && <p className="text-xs font-semibold text-accent">Time! Final score {score}.</p>}
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
          {busy && <p className="text-[10px] text-ink-faint">{carrying ? "delivering…" : "heading to pickup…"}</p>}
          {!running && (
            <button onClick={() => startMode("dispatch")} className={BTN}>↻ Play again</button>
          )}
        </div>
      )}

      {mode === "intercept" && (
        <div className="flex flex-col gap-1">
          {running ? (
            <p className="text-[11px] text-ink-faint">Click the map to chase the red car into your ring.</p>
          ) : (
            <>
              <p className="text-xs font-semibold text-accent">Time! Caught {score}.</p>
              <button onClick={() => startMode("intercept")} className={BTN}>↻ Play again</button>
            </>
          )}
        </div>
      )}

      {mode === "tsp" && (
        <div className="flex flex-col gap-1.5">
          {!tsp ? (
            <>
              <p className="text-[11px] text-ink-faint">
                From <b>S</b>, click the stops in the order you'd visit them — find the shortest loop.
              </p>
              <button
                onClick={submitTsp}
                disabled={picked.length !== stops.length}
                className={`${BTN} disabled:opacity-40`}
              >
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
