/**
 * Free, keyless geocoding via Photon (OpenStreetMap data, komoot-hosted).
 * Turns a typed address into coordinates + a human label, anywhere on Earth.
 * No API key, CORS-enabled, HTTPS — safe to call straight from the browser.
 *
 * Usage policy: it's a shared free service, so we debounce + cap results. For
 * production scale you'd self-host Photon/Nominatim or use a provider tier.
 */

export interface Place {
  label: string;
  lat: number;
  lng: number;
}

const PHOTON = "https://photon.komoot.io/api/";

interface PhotonFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: Record<string, string | undefined>;
}

function toPlace(f: PhotonFeature): Place | null {
  const c = f.geometry?.coordinates;
  if (!c || c.length < 2) return null;
  const [lng, lat] = c;
  const p = f.properties ?? {};
  const parts = [p.name, p.street, p.city ?? p.county ?? p.district, p.state, p.country].filter(
    (x): x is string => Boolean(x),
  );
  const label = (parts.length ? parts.join(", ") : `${lat.toFixed(4)}, ${lng.toFixed(4)}`).slice(0, 90);
  return { label, lat, lng };
}

/** Search addresses/places worldwide. Returns up to `limit` matches (empty on error). */
export async function searchPlaces(
  query: string,
  signal?: AbortSignal,
  limit = 6,
): Promise<Place[]> {
  const q = query.trim();
  if (q.length < 3) return [];
  try {
    const res = await fetch(`${PHOTON}?q=${encodeURIComponent(q)}&limit=${limit}`, { signal });
    if (!res.ok) return [];
    const data = (await res.json()) as { features?: PhotonFeature[] };
    const seen = new Set<string>();
    const out: Place[] = [];
    for (const f of data.features ?? []) {
      const place = toPlace(f);
      if (place && !seen.has(place.label)) {
        seen.add(place.label);
        out.push(place);
      }
    }
    return out;
  } catch {
    return []; // aborted or network error — caller treats as "no matches"
  }
}
