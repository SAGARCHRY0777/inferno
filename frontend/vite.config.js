var _a;
import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
// The dev server proxies API + WebSocket traffic to the gateway so the browser
// only ever talks to one origin (no CORS surprises in dev). The gateway URL is
// the single place to change the backend target.
var GATEWAY = (_a = process.env.VITE_GATEWAY_URL) !== null && _a !== void 0 ? _a : "http://127.0.0.1:8000";
export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    },
    server: {
        port: 5173,
        proxy: {
            "/api": { target: GATEWAY, changeOrigin: true, ws: true },
            "/metrics": { target: GATEWAY, changeOrigin: true },
        },
    },
    build: { outDir: "dist", sourcemap: true },
});
