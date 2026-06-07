import "leaflet/dist/leaflet.css";

import L from "leaflet";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
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
  ROUTE_GEOMETRY,
  ROUTE_GEOMETRY_SOURCE,
  type RoutePlan,
  routeThrough,
  SF_CENTER,
  VEHICLE_CLASSES,
  type Vehicle,
  planRoute,
  spawnVehicle,
  stepVehicle,
} from "@/lib/fleet";
import { type Place, searchPlaces } from "@/lib/geocode";
import { useStore } from "@/store/useStore";

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

const TICK_MS = 120;
const TIME_SCALE = 26; // accelerate so motion is visible at city scale
const MAX_VEHICLES = 60; // cap so "Add"/"Dispatch" can't grow state unboundedly
const TRAIL_COLOR = "#00E5FF";
const CHARGE_COLOR = "#FFB020";

function vehicleIcon(v: Vehicle): L.DivIcon {
  const color = v.status === "charging" ? CHARGE_COLOR : TRAIL_COLOR;
  return L.divIcon({
    className: "av-marker", // CSS transitions its transform so it glides between ticks
    iconSize: [16, 16],
    iconAnchor: [8, 8],
    html: `<div style="transform:rotate(${v.heading}deg);filter:drop-shadow(0 0 4px ${color})">
      <svg width="16" height="16" viewBox="0 0 16 16">
        <path d="M8 1 L13 14 L8 11 L3 14 Z" fill="${color}" stroke="#0A0B0F" stroke-width="0.6"/>
      </svg></div>`,
  });
}

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
  const jobs = useStore((s) => s.jobs);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [running, setRunning] = useState(true);
  const [speed, setSpeed] = useState(1);
  const speedRef = useRef(1);
  speedRef.current = speed;

  // A -> B route planner state.
  const [planMode, setPlanMode] = useState(false);
  const [picks, setPicks] = useState<LatLng[]>([]);
  const [planned, setPlanned] = useState<LatLng[] | null>(null);
  const [planStatus, setPlanStatus] = useState<"idle" | "planning" | "failed">("idle");

  // Multi-stop trip planner (geocoded addresses -> real distance + ETA, worldwide).
  const [stops, setStops] = useState<(Place | null)[]>([null, null]);
  const [trip, setTrip] = useState<RoutePlan | null>(null);
  const [tripStatus, setTripStatus] = useState<"idle" | "planning" | "failed">("idle");
  const [fitTarget, setFitTarget] = useState<LatLng[] | null>(null);
  const [driving, setDriving] = useState(false);
  const [tripCar, setTripCar] = useState<{ pos: LatLng; heading: number; t: number } | null>(null);

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
      void planRoute(next[0], next[1]).then((road) => {
        // Fall back to a straight line so the planner never hangs or breaks.
        setPlanned(road ?? next);
        setPlanStatus(road ? "idle" : "failed");
      });
    }
  };

  // Seed a starting fleet the first time the view opens.
  useEffect(() => {
    if (open && vehicles.length === 0) {
      setVehicles(Array.from({ length: 8 }, () => spawnVehicle()));
    }
  }, [open, vehicles.length]);

  // Simulation loop.
  useEffect(() => {
    if (!open || !running) return;
    const id = window.setInterval(() => {
      const dt = (TICK_MS / 1000) * TIME_SCALE * speedRef.current;
      setVehicles((vs) => vs.map((v) => stepVehicle(v, dt)));
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [open, running]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);

  // How many vehicles the latest YOLO detection found (cars/trucks/buses…).
  const detectedVehicles = useMemo(() => {
    const yolo = jobs.find((j) => j.modelName === "yolo-detect" && j.result);
    if (!yolo?.result) return [] as string[];
    return yolo.result.predictions
      .filter((p) => VEHICLE_CLASSES.has(p.label))
      .map((p) => p.label);
  }, [jobs]);

  const dispatchFromYolo = () => {
    const labels = detectedVehicles.slice(0, 12);
    if (labels.length === 0) return;
    setVehicles((vs) => [...vs, ...labels.map((l) => spawnVehicle(l))].slice(-MAX_VEHICLES));
  };

  const charging = vehicles.filter((v) => v.status === "charging").length;

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
                live path tracing ·{" "}
                {ROUTE_GEOMETRY_SOURCE === "osrm" ? "real road geometry (OSRM)" : "straight routes"} ·
                OpenStreetMap · worldwide trip planner
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
              className="h-full w-full"
              style={{ background: "#0A0B0F" }}
              zoomControl={false}
            >
              <TileLayer
                url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                attribution='&copy; OpenStreetMap &copy; CARTO'
              />
              <PlanPicker active={planMode} onPick={onPick} />
              {/* Real-road route outlines (key includes length so leaflet repaints). */}
              {ROUTE_GEOMETRY.map((r, i) => (
                <Polyline
                  key={`route-${i}-${r.length}`}
                  positions={r}
                  pathOptions={{ color: "#ffffff", weight: 1, opacity: 0.14 }}
                />
              ))}
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
              {vehicles.map((v) => (
                <Polyline
                  key={`${v.id}-trail`}
                  positions={v.trail}
                  pathOptions={{
                    color: v.status === "charging" ? CHARGE_COLOR : TRAIL_COLOR,
                    weight: 2,
                    opacity: 0.55,
                  }}
                />
              ))}
              {vehicles.map((v) => (
                <Marker key={v.id} position={v.pos} icon={vehicleIcon(v)}>
                  <Popup>
                    <div className="text-xs">
                      <b>{v.name}</b> · {v.label}
                      <br />
                      {v.status} · {v.speedKph.toFixed(0)} km/h
                      <br />
                      battery {v.battery.toFixed(0)}%
                    </div>
                  </Popup>
                </Marker>
              ))}
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
                  Couldn’t route those stops — try nearby addresses.
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

            {/* Controls overlay */}
            <div className="glass-raised absolute left-4 top-4 z-[1000] flex w-60 flex-col gap-3 p-4">
              <div className="flex items-center justify-between">
                <span className="label-eyebrow">Fleet</span>
                <span className="tnum text-xs text-accent">{vehicles.length} vehicles</span>
              </div>
              <div className="grid grid-cols-3 gap-1 text-center text-[11px]">
                <div className="rounded-lg bg-surface/50 py-1.5">
                  <div className="tnum text-sm text-ink">{vehicles.length - charging}</div>
                  <div className="text-ink-faint">en route</div>
                </div>
                <div className="rounded-lg bg-surface/50 py-1.5">
                  <div className="tnum text-sm text-warn">{charging}</div>
                  <div className="text-ink-faint">charging</div>
                </div>
                <div className="rounded-lg bg-surface/50 py-1.5">
                  <div className="tnum text-sm text-ink">{ROUTE_GEOMETRY.length}</div>
                  <div className="text-ink-faint">routes</div>
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => setVehicles((vs) => [...vs, spawnVehicle()].slice(-MAX_VEHICLES))}
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

              <button
                onClick={dispatchFromYolo}
                disabled={detectedVehicles.length === 0}
                title="Spawn a vehicle for each car/truck/bus from the latest YOLO detection"
                className="focusable rounded-lg border border-accent/50 bg-accent/10 py-1.5 text-xs text-accent transition hover:bg-accent/20 disabled:opacity-40"
              >
                Dispatch {detectedVehicles.length} from YOLO
              </button>

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
                  {planStatus === "failed" && "routing unavailable — straight line"}
                  {planStatus === "idle" && (planned ? "real-road route drawn ✓" : `${picks.length}/2 points`)}
                </p>
              )}

              <label className="flex flex-col gap-1 text-[11px] text-ink-muted">
                speed ×{speed.toFixed(1)}
                <input
                  type="range"
                  min={0.5}
                  max={4}
                  step={0.5}
                  value={speed}
                  onChange={(e) => setSpeed(Number(e.target.value))}
                  className="accent-accent"
                />
              </label>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
