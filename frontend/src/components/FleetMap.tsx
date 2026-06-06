import "leaflet/dist/leaflet.css";

import L from "leaflet";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMapEvents } from "react-leaflet";

import {
  type LatLng,
  ROUTE_GEOMETRY,
  ROUTE_GEOMETRY_SOURCE,
  SF_CENTER,
  VEHICLE_CLASSES,
  type Vehicle,
  planRoute,
  spawnVehicle,
  stepVehicle,
} from "@/lib/fleet";
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
                OpenStreetMap · San Francisco
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
