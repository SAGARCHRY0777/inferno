import L from "leaflet";
import { useEffect, useRef, useState } from "react";
import { Marker, Popup, useMap, useMapEvents } from "react-leaflet";

import { type Car, carDisplay, domainOf, flag, iconOf } from "@/lib/cars";
import { makeWorldFleet, spawnAt, stepWorldVehicle, type WorldVehicle } from "@/lib/world";

const TICK = 120;
const TIME_SCALE = 26;
const CAP = 240; // max markers rendered at once (keeps DOM/RAM flat at any zoom)
const FLEET_SIZE = 1400;

export interface WorldApi {
  add: (car?: Car) => void;
}

function icon(v: WorldVehicle): L.DivIcon {
  if (domainOf(v.car) === "road") {
    return L.divIcon({
      className: "av-marker",
      iconSize: [11, 11],
      iconAnchor: [5.5, 5.5],
      html: `<div style="transform:rotate(${v.heading}deg);filter:drop-shadow(0 0 3px #00E5FF)">
        <svg width="11" height="11" viewBox="0 0 16 16"><path d="M8 1 L13 14 L8 11 L3 14 Z"
        fill="#00E5FF" stroke="#0A0B0F" stroke-width="0.7"/></svg></div>`,
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

  const cull = (step: boolean) => {
    const b = map.getBounds();
    const padded = step ? b.pad(0.25) : b;
    const dt = (TICK / 1000) * TIME_SCALE;
    const arr = fleet.current;
    const vis: WorldVehicle[] = [];
    for (let i = 0; i < arr.length; i++) {
      if (step && padded.contains(arr[i].pos as L.LatLngExpression)) {
        arr[i] = stepWorldVehicle(arr[i], dt);
      }
      if (vis.length < CAP && b.contains(arr[i].pos as L.LatLngExpression)) vis.push(arr[i]);
    }
    setVisible(vis);
    if (onCounts && vis.length !== lastCount.current) {
      lastCount.current = vis.length;
      onCounts(vis.length, arr.length);
    }
  };

  // expose add() to the parent (spawns near the current map center, in view)
  useEffect(() => {
    api.current = {
      add: (car) => {
        const c = map.getCenter();
        fleet.current.push(spawnAt([c.lat, c.lng], car));
        cull(false);
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  // re-cull when the map moves (instant local traffic on pan/zoom)
  useMapEvents({ moveend: () => cull(false), zoomend: () => cull(false) });
  // initial population
  useEffect(() => {
    cull(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // animate the in-view vehicles
  useEffect(() => {
    if (hidden || paused) return;
    const id = window.setInterval(() => cull(true), TICK);
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
