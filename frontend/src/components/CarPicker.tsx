import { useMemo, useState } from "react";

import { brands, type Car, carDisplay, countries, domains, filterCars, types } from "@/lib/cars";

/** A filterable catalogue of real vehicles (road/sea/air/underwater). Picking one spawns it. */
export function CarPicker({ onPick, onClose }: { onPick: (c: Car) => void; onClose: () => void }) {
  const [domain, setDomain] = useState("");
  const [brand, setBrand] = useState("");
  const [country, setCountry] = useState("");
  const [type, setType] = useState("");
  const [q, setQ] = useState("");

  const list = useMemo(
    () => filterCars({ domain, brand, country, type, q }),
    [domain, brand, country, type, q],
  );
  const sel =
    "focusable rounded-lg border border-hairline bg-surface/60 px-1.5 py-1 text-[11px] text-ink";

  return (
    <div className="glass-raised flex w-72 flex-col gap-2 p-4">
      <div className="flex items-center justify-between">
        <span className="label-eyebrow">Choose a car · {list.length}</span>
        <button
          onClick={onClose}
          className="focusable rounded-md border border-hairline px-2 py-0.5 text-[10px] text-ink-muted hover:text-ink"
        >
          ✕
        </button>
      </div>

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="search brand or model…"
        className="focusable w-full rounded-lg border border-hairline bg-surface/60 px-2.5 py-1.5 text-xs text-ink placeholder:text-ink-faint"
      />

      <div className="grid grid-cols-2 gap-1">
        <select value={domain} onChange={(e) => setDomain(e.target.value)} className={sel}>
          <option value="">domain</option>
          {domains().map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <select value={brand} onChange={(e) => setBrand(e.target.value)} className={sel}>
          <option value="">brand</option>
          {brands().map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
        <select value={country} onChange={(e) => setCountry(e.target.value)} className={sel}>
          <option value="">country</option>
          {countries().map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select value={type} onChange={(e) => setType(e.target.value)} className={sel}>
          <option value="">type</option>
          {types().map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

      <ul className="flex max-h-64 flex-col gap-1 overflow-auto">
        {list.map((c, i) => (
          <li key={`${c.brand}-${c.model}-${i}`}>
            <button
              onClick={() => onPick(c)}
              className="focusable flex w-full items-center justify-between rounded-lg border border-hairline bg-surface/40 px-2 py-1.5 text-[11px] hover:bg-surface-hover"
            >
              <span className="truncate">{carDisplay(c)}</span>
              <span className="ml-2 shrink-0 text-ink-faint">{c.type}</span>
            </button>
          </li>
        ))}
        {list.length === 0 && <li className="px-1 py-2 text-[11px] text-ink-faint">No cars match.</li>}
      </ul>
    </div>
  );
}
