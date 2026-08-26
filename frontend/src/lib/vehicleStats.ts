/**
 * Game stats for a playable vehicle.
 *
 * The catalogue in `cars.ts` describes 160 real vehicles but the games ignored
 * all of them — every mode drove the same generic green arrow at one fixed
 * speed. These stats turn the catalogue into an actual choice.
 *
 * The core trade-off is deliberate and inverse: **the faster you move, the less
 * each delivery pays.** A superbike does many small runs; a semi does few large
 * ones. Neither dominates, so picking a vehicle is a strategy decision rather
 * than a cosmetic one.
 *
 * Only ROAD vehicles are playable. Every game mode routes over OSRM's driving
 * profile, so a container ship or an airliner has no meaningful path — offering
 * them would produce the same broken straight-line "routes" the fleet planner
 * used to draw.
 */
import { type Car, type Category, categoryOf, domainOf } from "./cars";

export interface VehicleStats {
  /** Multiplies travel speed along a route. 1.0 = the old fixed default. */
  speedMul: number;
  /** Multiplies the payout of a completed delivery. */
  rewardMul: number;
  /** One-line description of how this class plays. */
  blurb: string;
}

const BY_CATEGORY: Record<Category, VehicleStats> = {
  bike: { speedMul: 1.45, rewardMul: 0.65, blurb: "Fastest on the map — small, frequent fares." },
  emergency: { speedMul: 1.3, rewardMul: 0.95, blurb: "Blue-light speed with a near-normal payout." },
  car: { speedMul: 1.0, rewardMul: 1.0, blurb: "The balanced all-rounder." },
  bus: { speedMul: 0.8, rewardMul: 1.7, blurb: "Slow, but moves a lot of people per run." },
  truck: { speedMul: 0.62, rewardMul: 2.4, blurb: "Sluggish — every load pays big." },
  // Non-road classes are filtered out of the garage; these exist so the record
  // stays exhaustive (and the compiler catches a new Category being added).
  train: { speedMul: 1.15, rewardMul: 1.9, blurb: "Rail only — not road-playable." },
  ship: { speedMul: 0.5, rewardMul: 3.0, blurb: "Sea only — not road-playable." },
  boat: { speedMul: 0.9, rewardMul: 1.2, blurb: "Sea only — not road-playable." },
  aircraft: { speedMul: 2.0, rewardMul: 1.5, blurb: "Air only — not road-playable." },
  submarine: { speedMul: 0.45, rewardMul: 2.6, blurb: "Underwater only — not road-playable." },
};

/** Per-type nudges so two vehicles in one category still feel different. */
const TYPE_SPEED: Partial<Record<Car["type"], number>> = {
  sports: 1.22,
  EV: 1.1,
  coupe: 1.08,
  sedan: 1.0,
  hatchback: 0.96,
  SUV: 0.92,
  offroad: 0.88,
  motorcycle: 1.05,
  scooter: 0.72,
  // Light commercial sits between a car and a rigid truck — a Hilux should not
  // handle like a fully loaded semi just because both are in the truck category.
  pickup: 1.5,
  van: 1.35,
  truck: 1.05,
  semi: 0.92,
  tanker: 0.9,
  dumper: 0.7,
  mixer: 0.72,
  police: 1.1,
  ambulance: 1.0,
  firetruck: 0.82,
  bus: 1.0,
  coach: 1.08,
};

export function statsFor(car: Car): VehicleStats {
  const base = BY_CATEGORY[categoryOf(car)];
  const nudge = TYPE_SPEED[car.type] ?? 1;
  return {
    ...base,
    // Rounded so the HUD shows a stable number rather than 1.0000000000000002.
    speedMul: Math.round(base.speedMul * nudge * 100) / 100,
  };
}

/** Can this vehicle actually drive the road courses the games generate? */
export function isPlayable(car: Car): boolean {
  return domainOf(car) === "road";
}

/** Categories offered in the garage, in the order they appear. */
export const PLAYABLE_CATEGORIES: Category[] = ["car", "bike", "truck", "bus", "emergency"];

/** A 0-5 star rating for the HUD, so the trade-off is legible at a glance. */
export function stars(value: number, max: number): string {
  const filled = Math.max(1, Math.min(5, Math.round((value / max) * 5)));
  return "★".repeat(filled) + "·".repeat(5 - filled);
}
