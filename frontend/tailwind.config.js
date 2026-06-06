/** @type {import('tailwindcss').Config} */
// The design system is driven by CSS variables so themes can be swapped at
// runtime (see src/theme/themes.ts). Solid colors are RGB triplets consumed via
// `rgb(var(--c-x) / <alpha-value>)` so Tailwind opacity modifiers still work
// (e.g. bg-surface/70). Effect colors (hairline, glows) are full color strings.
const c = (v) => `rgb(var(${v}) / <alpha-value>)`;

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        base: c("--c-base"),
        surface: {
          DEFAULT: c("--c-surface"),
          raised: c("--c-surface-raised"),
          hover: c("--c-surface-hover"),
        },
        hairline: "var(--c-hairline)",
        accent: {
          DEFAULT: c("--c-accent"),
          dim: c("--c-accent-dim"),
          glow: "var(--c-accent-glow)",
        },
        warn: { DEFAULT: c("--c-warn"), glow: "var(--c-warn-glow)" },
        danger: { DEFAULT: c("--c-danger"), glow: "var(--c-danger-glow)" },
        ok: { DEFAULT: c("--c-ok") },
        ink: {
          DEFAULT: c("--c-ink"),
          muted: c("--c-ink-muted"),
          faint: c("--c-ink-faint"),
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["'JetBrains Mono'", "ui-monospace", "monospace"],
      },
      boxShadow: {
        glass: "0 1px 0 0 rgba(255,255,255,0.04) inset, 0 8px 30px rgba(0,0,0,0.5)",
        glow: "0 0 0 1px var(--c-accent-glow), 0 0 24px var(--c-accent-glow)",
      },
      backdropBlur: { xs: "2px" },
      borderRadius: { xl2: "1.25rem" },
      keyframes: {
        shimmer: { "100%": { transform: "translateX(100%)" } },
        pulseRing: {
          "0%": { transform: "scale(0.8)", opacity: "0.7" },
          "100%": { transform: "scale(2.4)", opacity: "0" },
        },
        marquee: {
          "0%": { transform: "translateX(0)" },
          "100%": { transform: "translateX(-50%)" },
        },
        floatY: {
          "0%,100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-6px)" },
        },
      },
      animation: {
        shimmer: "shimmer 1.6s infinite",
        pulseRing: "pulseRing 1.8s ease-out infinite",
        marquee: "marquee 28s linear infinite",
        floatY: "floatY 6s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
