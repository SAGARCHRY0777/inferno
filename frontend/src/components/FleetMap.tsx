import "leaflet/dist/leaflet.css";

import L from "leaflet";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import {
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  useMap,
  useMapEvents,
} from "react-leaflet";

import {
  bearing,
  formatEta,
  formatKm,
  type LatLng,
  type RoutePlan,
  routeThrough,
  SF_CENTER,
  planRoute,
} from "@/lib/fleet";
import { type Car, carDisplay } from "@/lib/cars";
import { type Place, searchPlaces } from "@/lib/geocode";
import { useStore } from "@/store/useStore";
import { CarPicker } from "./CarPicker";
import { FleetGames } from "./FleetGames";
import { type WorldApi, WorldFleet } from "./WorldFleet";

/** Captures map clicks for the A->B route planner (must live inside MapContainer). */
function PlanPicker({ active, onPick }: { active: boolean; onPick: (p: LatLng) => void }) {
  useMapEvents({
    click(e) {
      if (active) onPick([e.latlng.lat, e.latlng.lng]);
    },
  });
  return null;
}

function pinIcon(color: string): L.DivIcon {
  return L.divIcon({
    className: "",
    iconSize: [12, 12],
    iconAnchor: [6, 6],
    html: `<div style="width:12px;height:12px;border-radius:50%;background:${color};box-shadow:0 0 8px ${color};border:2px solid #0A0B0F"></div>`,
  });
}

const TRAIL_COLOR = "#00E5FF";

const STOP_COLORS = ["#3DDC97", "#FF4D6D", "#FFB020", "#00E5FF", "#B388FF", "#FF8A65"];

/** A lettered (A, B, C…) stop marker for the trip planner. */
function stopPin(index: number): L.DivIcon {
  const color = STOP_COLORS[index % STOP_COLORS.length];
  const letter = String.fromCharCode(65 + index);
  return L.divIcon({
    className: "",
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    html: `<div style="width:22px;height:22px;border-radius:50%;background:${color};color:#0A0B0F;
      font:700 12px/22px ui-sans-serif,system-ui;text-align:center;box-shadow:0 0 10px ${color};
      border:2px solid #0A0B0F">${letter}</div>`,
  });
}

/** The dispatched vehicle driving the planned route (a heading-aware arrow). */
function tripCarIcon(heading: number): L.DivIcon {
  return L.divIcon({
    className: "av-marker",
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    html: `<div style="transform:rotate(${heading}deg);filter:drop-shadow(0 0 6px #3DDC97)">
      <svg width="22" height="22" viewBox="0 0 16 16">
        <path d="M8 0.5 L13.5 14.5 L8 11 L2.5 14.5 Z" fill="#3DDC97" stroke="#0A0B0F" stroke-width="0.7"/>
      </svg></div>`,
  });
}

/** Pans/zooms the map to fit the planned trip's geometry. */
function FitBounds({ positions }: { positions: LatLng[] | null }) {
  const map = useMap();
  useEffect(() => {
    if (positions && positions.length > 0) {
      map.fitBounds(positions as L.LatLngBoundsExpression, { padding: [60, 60] });
    }
  }, [positions, map]);
  return null;
}

/** Free-text address box with debounced worldwide autocomplete (Photon/OSM). */
function AddressInput({
  index,
  value,
  onSelect,
}: {
  index: number;
  value: Place | null;
  onSelect: (p: Place) => void;
}) {
  const [q, setQ] = useState(value?.label ?? "");
  const [results, setResults] = useState<Place[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setQ(value?.label ?? "");
  }, [value]);

  useEffect(() => {
    if (!q || (value && q === value.label)) {
      setResults([]);
      return;
    }
    const ctrl = new AbortController();
    const id = window.setTimeout(() => {
      void searchPlaces(q, ctrl.signal).then((r) => {
        setResults(r);
        setOpen(r.length > 0);
      });
    }, 300);
    return () => {
      ctrl.abort();
      window.clearTimeout(id);
    };
  }, [q, value]);

  const letter = String.fromCharCode(65 + index);
  return (
    <div className="relative">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
        placeholder={`${letter} · type an address…`}
        className="focusable w-full rounded-lg border border-hairline bg-surface/60 px-2.5 py-1.5 text-xs text-ink placeholder:text-ink-faint"
      />
      {open && results.length > 0 && (
        <ul className="absolute z-[1100] mt-1 max-h-48 w-full overflow-auto rounded-lg border border-hairline bg-base shadow-xl">
          {results.map((r, i) => (
            <li
              key={`${r.lat}-${r.lng}-${i}`}
              onClick={() => {
                onSelect(r);
                setQ(r.label);
                setOpen(false);
              }}
              className="cursor-pointer px-2.5 py-1.5 text-[11px] text-ink-muted hover:bg-surface-hover"
            >
              {r.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function FleetMap() {
  const open = useStore((s) => s.fleetOpen);
  const setOpen = useStore((s) => s.setFleetOpen);
  const [running, setRunning] = useState(true);
  const worldApi = useRef<WorldApi | null>(null);
  const [worldCount, setWorldCount] = useState({ visible: 0, total: 0 });

  // A -> B route planner state.
  const [planMode, setPlanMode] = useState(false);
  const [picks, setPicks] = useState<LatLng[]>([]);
  // Monotonic id for in-flight route requests; only the newest may apply.
  const routeSeq = useRef(0);
  const [planned, setPlanned] = useState<LatLng[] | null>(null);
  const [planStatus, setPlanStatus] = useState<"idle" | "planning" | "failed">("idle");

  // Multi-stop trip planner (geocoded addresses -> real distance + ETA, worldwide).
  const [stops, setStops] = useState<(Place | null)[]>([null, null]);
  const [trip, setTrip] = useState<RoutePlan | null>(null);
  const [tripStatus, setTripStatus] = useState<"idle" | "planning" | "failed">("idle");
  const [fitTarget, setFitTarget] = useState<LatLng[] | null>(null);
  const [driving, setDriving] = useState(false);
  const [tripCar, setTripCar] = useState<{ pos: LatLng; heading: number; t: number } | null>(null);
  const [gameHud, setGameHud] = useState<HTMLDivElement | null>(null);
  const [gameActive, setGameActive] = useState(false);
  const [hideFleet, setHideFleet] = useState(false);
  const fleetHidden = gameActive || hideFleet;
  const [carPickerOpen, setCarPickerOpen] = useState(false);
  const [activeCar, setActiveCar] = useState<Car | null>(null);

  const addVehicle = (car?: Car) => worldApi.current?.add(car);

  // Drain any vehicles YOLO detected while the map was closed. The map mounts
  // its Leaflet context only when open, so the queue is filled by SubmitPanel
  // and consumed here on open.
  const takeFleetSpawns = useStore((s) => s.takeFleetSpawns);
  const queued = useStore((s) => s.fleetSpawnQueue.length);
  const pushToast = useStore((s) => s.pushToast);
  useEffect(() => {
    if (!open || !queued) return;
    // One tick, so WorldFleet has registered its api before we call into it.
    const id = window.setTimeout(() => {
      const labels = takeFleetSpawns();
      const n = worldApi.current?.addDetected(labels) ?? 0;
      if (n) pushToast("info", `🚗 ${n} detected vehicle${n === 1 ? "" : "s"} added to the fleet`);
    }, 300);
    return () => window.clearTimeout(id);
  }, [open, queued, takeFleetSpawns, pushToast]);

  const setStop = (i: number, p: Place) => setStops((s) => s.map((v, idx) => (idx === i ? p : v)));
  const addStop = () => setStops((s) => (s.length >= 6 ? s : [...s, null]));
  const removeStop = (i: number) =>
    setStops((s) => (s.length <= 2 ? s : s.filter((_, idx) => idx !== i)));
  const filledStops = stops.filter((p): p is Place => p !== null);

  const planTrip = async () => {
    const coords = filledStops.map((p) => [p.lat, p.lng] as LatLng);
    if (coords.length < 2) return;
    setTripStatus("planning");
    setTrip(null);
    setTripCar(null);
    setDriving(false);
    const plan = await routeThrough(coords);
    if (plan) {
      setTrip(plan);
      setTripStatus("idle");
      setFitTarget(plan.geometry);
    } else {
      setTripStatus("failed");
    }
  };

  const driveTrip = () => {
    if (!trip || trip.geometry.length < 2) return;
    setTripCar({ pos: trip.geometry[0], heading: 0, t: 0 });
    setDriving(true);
  };

  // Animate the dispatched vehicle along the route at a steady pace.
  useEffect(() => {
    if (!driving || !trip || trip.geometry.length < 2) return;
    const geom = trip.geometry;
    const durationMs = Math.min(45000, Math.max(12000, trip.durationS * 25));
    const tickMs = 90;
    let t = 0;
    const id = window.setInterval(() => {
      t = Math.min(1, t + tickMs / durationMs);
      const f = t * (geom.length - 1);
      const i = Math.min(Math.floor(f), geom.length - 2);
      const a = geom[i];
      const b = geom[i + 1];
      const frac = f - i;
      setTripCar({
        pos: [a[0] + (b[0] - a[0]) * frac, a[1] + (b[1] - a[1]) * frac],
        heading: bearing(a, b),
        t,
      });
      if (t >= 1) {
        setDriving(false);
        window.clearInterval(id);
      }
    }, tickMs);
    return () => window.clearInterval(id);
  }, [driving, trip]);

  const onPick = (p: LatLng) => {
    const next = picks.length >= 2 ? [p] : [...picks, p];
    setPicks(next);
    setPlanned(null);
    setPlanStatus("idle");
    if (next.length === 2) {
      setPlanStatus("planning");
      // Sequence guard: OSRM can take up to 8s, so picking a new pair while a
      // request is in flight would let the older, slower response resolve last
      // and overwrite the map with a stale route.
      const seq = ++routeSeq.current;
      void planRoute(next[0], next[1]).then((road) => {
        if (seq !== routeSeq.current) return; // superseded by a newer pick
        // Fall back to a straight line so the planner never hangs or breaks.
        setPlanned(road ?? next);
        setPlanStatus(road ? "idle" : "failed");
      });
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[92] flex flex-col bg-base"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          {/* Top bar */}
          <div className="flex shrink-0 items-center justify-between border-b border-hairline px-5 py-3">
            <div>
              <h2 className="text-sm font-semibold">Fleet Command · Autonomous Vehicles</h2>
              <p className="text-[11px] text-ink-faint">
                worldwide fleet · {worldCount.visible} in view / {worldCount.total} total ·
                OpenStreetMap · trip planner + arcade
              </p>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="focusable rounded-lg border border-hairline px-3 py-1.5 text-xs text-ink-muted hover:bg-surface-hover"
            >
              Esc ✕
            </button>
          </div>

          {/* Map */}
          <div className="relative min-h-0 flex-1">
            <MapContainer
              center={SF_CENTER}
              zoom={13}
              minZoom={2}
              maxBounds={[
                [-85, -180],
                [85, 180],
              ]}
              maxBoundsViscosity={1}
              worldCopyJump={false}
              className="h-full w-full"
              style={{ background: "#0A0B0F" }}
              zoomControl={false}
            >
              {/*
                Standard OpenStreetMap tiles, darkened in CSS (.map-tiles-dark).

                CARTO's dark_all basemap used to be keyless; it now stamps
                "API KEY REQUIRED" diagonally across every tile while still
                returning HTTP 200 — so the map silently rendered defaced rather
                than failing. OSM's standard tiles need no key, and a CSS filter
                gets the dark look back without a third-party dependency.
              */}
              <TileLayer
                noWrap
                className="map-tiles-dark"
                url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              />
              <PlanPicker active={planMode} onPick={onPick} />
              {/* Worldwide fleet — only the in-view vehicles are stepped + drawn. */}
              <WorldFleet
                hidden={fleetHidden}
                paused={!running}
                api={worldApi}
                onCounts={(visible, total) => setWorldCount({ visible, total })}
              />
              {/* A->B planned route + endpoint pins. */}
              {planned && (
                <Polyline key={`plan-${planned.length}`} positions={planned} pathOptions={{ color: TRAIL_COLOR, weight: 3, opacity: 0.9 }} />
              )}
              {picks.map((p, i) => (
                <Marker key={`pick-${i}`} position={p} icon={pinIcon(i === 0 ? "#3DDC97" : "#FF4D6D")} />
              ))}
              {/* Multi-stop trip route + lettered stop markers + auto-fit to bounds. */}
              <FitBounds positions={fitTarget} />
              {trip && (
                <Polyline
                  key={`trip-${trip.geometry.length}`}
                  positions={trip.geometry}
                  pathOptions={{ color: "#3DDC97", weight: 4, opacity: 0.95 }}
                />
              )}
              {filledStops.map((p, i) => (
                <Marker key={`stop-${i}-${p.lat}-${p.lng}`} position={[p.lat, p.lng]} icon={stopPin(i)}>
                  <Popup>
                    <div className="text-xs">
                      <b>{String.fromCharCode(65 + i)}</b> · {p.label}
                    </div>
                  </Popup>
                </Marker>
              ))}
              {/* The dispatched vehicle driving the route + the trail it has covered. */}
              {tripCar && trip && (
                <Polyline
                  key="tripcar-trail"
                  positions={trip.geometry.slice(
                    0,
                    Math.max(2, Math.floor(tripCar.t * (trip.geometry.length - 1)) + 1),
                  )}
                  pathOptions={{ color: "#00E5FF", weight: 5, opacity: 0.9 }}
                />
              )}
              {tripCar && <Marker position={tripCar.pos} icon={tripCarIcon(tripCar.heading)} />}
              {/* Arcade games (dispatch / route-rush / intercept) on the live map. */}
              <FleetGames hud={gameHud} onActive={setGameActive} />
            </MapContainer>

            {/* Trip planner overlay (right): geocode any address, route A→B→C→D */}
            <div className="glass-raised absolute right-4 top-4 z-[1000] flex max-h-[calc(100%-2rem)] w-72 flex-col gap-2 overflow-auto p-4">
              <div className="flex items-center justify-between">
                <span className="label-eyebrow">Trip planner</span>
                <span className="text-[10px] text-ink-faint">free · worldwide</span>
              </div>
              {stops.map((stop, i) => (
                <div key={`stopin-${i}`} className="flex items-center gap-1">
                  <div className="flex-1">
                    <AddressInput index={i} value={stop} onSelect={(p) => setStop(i, p)} />
                  </div>
                  {stops.length > 2 && (
                    <button
                      onClick={() => removeStop(i)}
                      title="Remove stop"
                      className="focusable shrink-0 rounded-md border border-hairline px-1.5 py-1 text-xs text-ink-faint hover:text-danger"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
              <div className="flex gap-2">
                <button
                  onClick={addStop}
                  disabled={stops.length >= 6}
                  className="focusable flex-1 rounded-lg border border-hairline px-2 py-1.5 text-[11px] text-ink-muted hover:bg-surface-hover disabled:opacity-40"
                >
                  + Add stop
                </button>
                <button
                  onClick={() => void planTrip()}
                  disabled={filledStops.length < 2 || tripStatus === "planning"}
                  className="focusable flex-1 rounded-lg bg-accent px-2 py-1.5 text-[11px] font-semibold text-base hover:brightness-110 disabled:opacity-40"
                >
                  {tripStatus === "planning" ? "Planning…" : "Plan trip"}
                </button>
              </div>
              {tripStatus === "failed" && (
                <p className="text-[11px] text-danger">
                  No drivable road route between those stops. Routing is road-only,
                  so stops must be on the same landmass and near a road.
                </p>
              )}
              {trip && (
                <div className="flex flex-col gap-1 rounded-lg border border-hairline bg-surface/40 p-2.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-ink-muted">Total</span>
                    <span className="tnum font-semibold text-accent">
                      {formatKm(trip.distanceM)} · {formatEta(trip.durationS)}
                    </span>
                  </div>
                  {trip.legs.map((leg, i) => (
                    <div
                      key={`leg-${i}`}
                      className="flex items-center justify-between text-[11px] text-ink-faint"
                    >
                      <span>
                        {String.fromCharCode(65 + i)} → {String.fromCharCode(66 + i)}
                      </span>
                      <span className="tnum">
                        {formatKm(leg.distanceM)} · {formatEta(leg.durationS)}
                      </span>
                    </div>
                  ))}
                  <button
                    onClick={() => (driving ? setDriving(false) : driveTrip())}
                    className="focusable mt-1 rounded-lg bg-accent px-2 py-1.5 text-[11px] font-semibold text-base hover:brightness-110"
                  >
                    {driving ? "■ Stop" : tripCar && tripCar.t >= 1 ? "↻ Drive again" : "🚗 Drive it"}
                  </button>
                  {tripCar && (
                    <div className="flex items-center gap-2">
                      <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-hover">
                        <div
                          className="h-full rounded-full bg-accent"
                          style={{ width: `${Math.round(tripCar.t * 100)}%` }}
                        />
                      </div>
                      <span className="tnum shrink-0 text-[10px] text-ink-muted">
                        {tripCar.t >= 1 ? "arrived" : `${formatEta(trip.durationS * (1 - tripCar.t))} left`}
                      </span>
                    </div>
                  )}
                  <p className="mt-1 text-[10px] text-ink-faint">
                    ETA is a typical drive time (no live traffic).
                  </p>
                </div>
              )}
            </div>

            {/* Arcade HUD container (FleetGames portals its panel here). */}
            <div ref={setGameHud} className="absolute bottom-4 left-4 z-[1000]" />

            {/* Real-car picker (filter by brand / country / type). */}
            {carPickerOpen && (
              <div className="absolute left-[17rem] top-4 z-[1001]">
                <CarPicker
                  onPick={(c) => {
                    setActiveCar(c);
                    addVehicle(c);
                  }}
                  onClose={() => setCarPickerOpen(false)}
                />
              </div>
            )}

            {/* Controls overlay */}
            <div className="glass-raised absolute left-4 top-4 z-[1000] flex w-60 flex-col gap-3 p-4">
              <div className="flex items-center justify-between">
                <span className="label-eyebrow">Worldwide fleet</span>
                <span className="tnum text-xs text-accent">{worldCount.total} total</span>
              </div>
              <div className="grid grid-cols-2 gap-1 text-center text-[11px]">
                <div className="rounded-lg bg-surface/50 py-1.5">
                  <div className="tnum text-sm text-ink">{worldCount.visible}</div>
                  <div className="text-ink-faint">in view</div>
                </div>
                <div className="rounded-lg bg-surface/50 py-1.5">
                  <div className="tnum text-sm text-accent">🌍</div>
                  <div className="text-ink-faint">pan anywhere</div>
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => addVehicle(activeCar ?? undefined)}
                  className="focusable flex-1 rounded-lg border border-hairline bg-surface/50 py-1.5 text-xs hover:bg-surface-hover"
                >
                  + Add
                </button>
                <button
                  onClick={() => setRunning((r) => !r)}
                  className="focusable rounded-lg border border-hairline bg-surface/50 px-3 py-1.5 text-xs hover:bg-surface-hover"
                >
                  {running ? "⏸" : "▶"}
                </button>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => setHideFleet((h) => !h)}
                  className="focusable flex-1 rounded-lg border border-hairline bg-surface/50 py-1.5 text-xs hover:bg-surface-hover"
                >
                  {hideFleet ? "👁 Show" : "🙈 Hide"}
                </button>
                <button
                  onClick={() => setCarPickerOpen((o) => !o)}
                  className="focusable flex-1 rounded-lg border border-hairline bg-surface/50 py-1.5 text-xs hover:bg-surface-hover"
                >
                  🚘 Cars
                </button>
              </div>
              {activeCar && (
                <p className="truncate text-center text-[10px] text-ink-faint">
                  + Add spawns: {carDisplay(activeCar)}
                </p>
              )}

              {/* A -> B real-road route planner */}
              <button
                onClick={() => {
                  setPlanMode((p) => !p);
                  setPicks([]);
                  setPlanned(null);
                  setPlanStatus("idle");
                }}
                className={`focusable rounded-lg border py-1.5 text-xs transition ${
                  planMode
                    ? "border-accent/60 bg-accent/15 text-accent"
                    : "border-hairline bg-surface/50 text-ink-muted hover:bg-surface-hover"
                }`}
              >
                {planMode ? "Planning — click 2 points" : "Plan a route (A → B)"}
              </button>
              {planMode && (
                <p className="text-[11px] text-ink-faint">
                  {planStatus === "planning" && "routing along real roads…"}
                  {planStatus === "failed" && "no road route between these points — direct line"}
                  {planStatus === "idle" && (planned ? "real-road route drawn ✓" : `${picks.length}/2 points`)}
                </p>
              )}

            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
