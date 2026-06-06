/**
 * 20 runtime-swappable themes.
 *
 * Each theme is a compact palette of RGB triplets ("r g b"); the applier derives
 * hairlines, glows, and background gradients from them and writes CSS variables
 * on <html>. Tailwind consumes those variables, so every component re-themes for
 * free. The choice is persisted to localStorage.
 */

export type ThemeGroup = "Dark" | "Light" | "Glass" | "Vibrant";

export interface Theme {
  id: string;
  name: string;
  group: ThemeGroup;
  light?: boolean;
  c: {
    base: string;
    surface: string;
    surfaceRaised: string;
    surfaceHover: string;
    ink: string;
    inkMuted: string;
    inkFaint: string;
    accent: string;
    accentDim: string;
    warn: string;
    danger: string;
    ok: string;
    glow2?: string; // secondary background gradient hue
  };
}

export const THEMES: Theme[] = [
  // ---- Dark ----
  { id: "midnight", name: "Midnight", group: "Dark", c: { base: "10 11 15", surface: "16 18 24", surfaceRaised: "22 25 34", surfaceHover: "28 32 43", ink: "231 236 243", inkMuted: "154 164 178", inkFaint: "91 101 115", accent: "0 229 255", accentDim: "0 184 204", warn: "255 176 32", danger: "255 77 109", ok: "61 220 151", glow2: "120 90 255" } },
  { id: "obsidian", name: "Obsidian", group: "Dark", c: { base: "8 8 10", surface: "18 18 20", surfaceRaised: "26 26 30", surfaceHover: "34 34 40", ink: "240 240 245", inkMuted: "160 160 170", inkFaint: "95 95 105", accent: "240 240 245", accentDim: "200 200 205", warn: "255 190 60", danger: "255 90 110", ok: "90 220 160", glow2: "90 90 110" } },
  { id: "carbon", name: "Carbon", group: "Dark", c: { base: "14 14 16", surface: "22 22 26", surfaceRaised: "30 30 34", surfaceHover: "38 38 44", ink: "234 234 236", inkMuted: "158 158 166", inkFaint: "96 96 104", accent: "255 122 48", accentDim: "220 100 40", warn: "255 196 70", danger: "255 80 90", ok: "80 210 150", glow2: "255 122 48" } },
  { id: "deepocean", name: "Deep Ocean", group: "Dark", c: { base: "8 16 26", surface: "16 28 44", surfaceRaised: "22 38 58", surfaceHover: "30 50 74", ink: "220 232 244", inkMuted: "150 172 194", inkFaint: "95 115 138", accent: "38 198 218", accentDim: "30 165 182", warn: "255 196 80", danger: "255 95 110", ok: "76 215 170", glow2: "56 130 230" } },
  { id: "crimson", name: "Crimson", group: "Dark", c: { base: "16 10 12", surface: "26 17 20", surfaceRaised: "36 24 28", surfaceHover: "46 31 36", ink: "240 228 230", inkMuted: "188 160 166", inkFaint: "120 96 102", accent: "255 70 90", accentDim: "215 55 75", warn: "255 180 80", danger: "255 70 90", ok: "90 215 150", glow2: "200 60 80" } },
  { id: "forest", name: "Forest", group: "Dark", c: { base: "9 16 13", surface: "16 28 22", surfaceRaised: "22 38 30", surfaceHover: "30 50 40", ink: "224 238 230", inkMuted: "150 178 164", inkFaint: "95 120 108", accent: "80 220 140", accentDim: "60 185 116", warn: "240 210 110", danger: "255 110 120", ok: "80 220 140", glow2: "60 160 120" } },

  // ---- Vibrant ----
  { id: "synthwave", name: "Synthwave", group: "Vibrant", c: { base: "18 10 30", surface: "30 18 48", surfaceRaised: "40 25 64", surfaceHover: "52 33 82", ink: "245 235 255", inkMuted: "190 165 215", inkFaint: "130 110 155", accent: "255 60 200", accentDim: "210 50 165", warn: "255 200 80", danger: "255 70 110", ok: "90 240 200", glow2: "80 220 255" } },
  { id: "matrix", name: "Matrix", group: "Vibrant", c: { base: "6 10 7", surface: "12 20 14", surfaceRaised: "18 28 20", surfaceHover: "24 38 27", ink: "200 255 210", inkMuted: "130 190 150", inkFaint: "80 130 95", accent: "57 255 120", accentDim: "40 210 95", warn: "230 230 90", danger: "255 95 95", ok: "57 255 120", glow2: "57 255 120" } },
  { id: "dracula", name: "Dracula", group: "Vibrant", c: { base: "26 27 38", surface: "40 42 58", surfaceRaised: "50 52 72", surfaceHover: "60 62 86", ink: "248 248 242", inkMuted: "170 172 195", inkFaint: "110 112 135", accent: "189 147 249", accentDim: "160 120 215", warn: "241 250 140", danger: "255 85 85", ok: "80 250 123", glow2: "255 121 198" } },
  { id: "nord", name: "Nord", group: "Vibrant", c: { base: "17 22 33", surface: "30 38 52", surfaceRaised: "38 47 64", surfaceHover: "46 57 77", ink: "216 222 233", inkMuted: "150 162 184", inkFaint: "100 110 130", accent: "136 192 208", accentDim: "110 165 180", warn: "235 203 139", danger: "191 97 106", ok: "163 190 140", glow2: "129 161 193" } },
  { id: "cyberpunk", name: "Cyberpunk", group: "Vibrant", c: { base: "12 12 8", surface: "22 22 14", surfaceRaised: "30 30 18", surfaceHover: "40 40 24", ink: "245 245 220", inkMuted: "190 190 150", inkFaint: "130 130 95", accent: "255 234 0", accentDim: "215 200 0", warn: "255 150 0", danger: "255 50 90", ok: "0 255 200", glow2: "0 220 255" } },
  { id: "royal", name: "Royal", group: "Vibrant", c: { base: "14 14 28", surface: "24 24 44", surfaceRaised: "32 32 58", surfaceHover: "42 42 74", ink: "232 232 246", inkMuted: "162 162 196", inkFaint: "108 108 144", accent: "212 175 55", accentDim: "180 148 46", warn: "240 200 90", danger: "240 90 120", ok: "110 200 160", glow2: "90 70 220" } },

  // ---- Glass ----
  { id: "frostglass", name: "Frost Glass", group: "Glass", c: { base: "14 18 28", surface: "26 32 46", surfaceRaised: "34 42 60", surfaceHover: "44 54 76", ink: "230 238 248", inkMuted: "160 176 198", inkFaint: "105 122 145", accent: "120 200 255", accentDim: "95 170 225", warn: "255 200 90", danger: "255 100 120", ok: "90 220 180", glow2: "150 130 255" } },
  { id: "auroraglass", name: "Aurora Glass", group: "Glass", c: { base: "10 14 24", surface: "22 28 44", surfaceRaised: "30 38 58", surfaceHover: "40 50 74", ink: "228 236 246", inkMuted: "156 172 196", inkFaint: "102 120 144", accent: "110 240 210", accentDim: "85 200 175", warn: "250 210 120", danger: "255 110 130", ok: "120 235 190", glow2: "150 110 255" } },
  { id: "rosegold", name: "Rose Gold", group: "Glass", c: { base: "28 20 22", surface: "40 30 32", surfaceRaised: "52 39 42", surfaceHover: "64 49 52", ink: "245 232 230", inkMuted: "198 172 168", inkFaint: "132 110 108", accent: "240 170 150", accentDim: "210 140 120", warn: "240 200 120", danger: "240 110 120", ok: "150 210 170", glow2: "230 150 180" } },
  { id: "amethyst", name: "Amethyst", group: "Glass", c: { base: "18 14 26", surface: "30 24 44", surfaceRaised: "40 32 58", surfaceHover: "52 42 74", ink: "236 230 248", inkMuted: "180 168 200", inkFaint: "120 110 145", accent: "170 130 255", accentDim: "140 105 220", warn: "245 205 120", danger: "250 110 140", ok: "120 220 190", glow2: "90 180 255" } },

  // ---- Light ----
  { id: "daylight", name: "Daylight", group: "Light", light: true, c: { base: "247 249 252", surface: "255 255 255", surfaceRaised: "248 250 253", surfaceHover: "238 242 248", ink: "20 28 40", inkMuted: "90 102 120", inkFaint: "150 160 175", accent: "0 122 255", accentDim: "0 100 220", warn: "200 120 0", danger: "215 50 70", ok: "30 170 110", glow2: "100 80 255" } },
  { id: "porcelain", name: "Porcelain", group: "Light", light: true, c: { base: "245 244 241", surface: "255 254 252", surfaceRaised: "249 248 245", surfaceHover: "238 236 231", ink: "34 32 30", inkMuted: "105 100 95", inkFaint: "160 154 148", accent: "70 90 110", accentDim: "55 72 90", warn: "190 120 20", danger: "200 60 60", ok: "60 150 100", glow2: "150 120 100" } },
  { id: "solarized", name: "Solarized", group: "Light", light: true, c: { base: "253 246 227", surface: "255 252 240", surfaceRaised: "248 240 222", surfaceHover: "238 230 212", ink: "70 90 96", inkMuted: "120 138 140", inkFaint: "165 175 170", accent: "38 139 210", accentDim: "30 115 175", warn: "181 137 0", danger: "220 50 47", ok: "133 153 0", glow2: "211 54 130" } },
  { id: "sandstone", name: "Sandstone", group: "Light", light: true, c: { base: "246 240 232", surface: "255 250 244", surfaceRaised: "249 242 233", surfaceHover: "240 232 221", ink: "50 40 32", inkMuted: "120 105 92", inkFaint: "170 156 142", accent: "200 96 50", accentDim: "170 80 42", warn: "200 140 30", danger: "200 70 60", ok: "90 160 90", glow2: "220 160 90" } },
];

const STORAGE_KEY = "inferno.theme";

function rgba(triplet: string, alpha: number): string {
  return `rgba(${triplet.split(" ").join(",")}, ${alpha})`;
}

export function applyTheme(theme: Theme): void {
  const r = document.documentElement;
  const set = (k: string, v: string) => r.style.setProperty(k, v);
  const c = theme.c;
  set("--c-base", c.base);
  set("--c-surface", c.surface);
  set("--c-surface-raised", c.surfaceRaised);
  set("--c-surface-hover", c.surfaceHover);
  set("--c-ink", c.ink);
  set("--c-ink-muted", c.inkMuted);
  set("--c-ink-faint", c.inkFaint);
  set("--c-accent", c.accent);
  set("--c-accent-dim", c.accentDim);
  set("--c-warn", c.warn);
  set("--c-danger", c.danger);
  set("--c-ok", c.ok);

  const line = theme.light ? "15 18 25" : "255 255 255";
  set("--c-hairline", rgba(line, theme.light ? 0.12 : 0.09));
  set("--c-accent-glow", rgba(c.accent, theme.light ? 0.28 : 0.35));
  set("--c-warn-glow", rgba(c.warn, 0.3));
  set("--c-danger-glow", rgba(c.danger, 0.3));
  set("--c-bg-glow-1", rgba(c.accent, theme.light ? 0.12 : 0.08));
  set("--c-bg-glow-2", rgba(c.glow2 ?? c.accent, theme.light ? 0.1 : 0.06));
  r.style.colorScheme = theme.light ? "light" : "dark";
}

export function getStoredThemeId(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? THEMES[0].id;
  } catch {
    return THEMES[0].id;
  }
}

export function storeThemeId(id: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* ignore */
  }
}

export function themeById(id: string): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

/** Apply the persisted theme as early as possible (called from main.tsx). */
export function initTheme(): Theme {
  const theme = themeById(getStoredThemeId());
  applyTheme(theme);
  return theme;
}
