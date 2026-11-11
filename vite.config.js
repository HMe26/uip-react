import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// The app calls the backend with relative URLs (/api/..., /uploads/...), so
// both `npm run dev` and `npm run preview` proxy them to the Laravel API.
// Production hosting does the same through vercel.json / netlify.toml.
// Override the backend with VITE_API_TARGET (see .env.example).
// [ANDROID] `vite build --mode native` (npm run build:native) builds the Android bundle. The only HTML change:
// no viewport-fit=cover, so Capacitor keeps the WebView *between* the status bar and the gesture bar
// instead of drawing the page underneath them.
const nativeHtml = (mode) => ({
  name: "uip-native-html",
  transformIndexHtml(html) {
    if (mode !== "native") return html;
    // [ANDROID-PERF] The Google Fonts <link> (+ preconnects) blocks the first paint inside the WebView until 4 font families are
    // downloaded. In the app it is removed from <head> and native.js adds it back after the first paint (system font until then).
    let fonts = "";
    const out = html
      .replace(/<link[^>]+fonts\.googleapis\.com\/css2[^>]*>/i, (m) => { fonts = (/href="([^"]+)"/.exec(m) || [])[1] || ""; return fonts ? `<meta name="uip-fonts" content="${fonts}" />` : m; })
      .replace(/<link[^>]+rel="preconnect"[^>]*fonts\.g[^>]*>\s*/gi, "");
    return out.replace(", viewport-fit=cover", "");
  },
});


// UIP OS: pages run INSIDE desktop windows, so `100vh` / `100vw` must mean "the window", not the browser.
// Every page stylesheet's viewport units become calc(N * var(--os-vh, 1vh)); VirtualApp sets --os-vh / --os-vw on the window
// (ResizeObserver), everywhere else the variables are undefined and the fallback is the real viewport unit - nothing changes.
// The desktop shell itself (src/desktop, src/virtual) keeps real viewport units.
const UNIT = /(-?\d*\.?\d+)(dvh|svh|lvh|vh|dvw|svw|lvw|vw)\b/g;
const windowUnits = () => ({
  postcssPlugin: "uip-window-units",
  Declaration(decl) {
    const file = (decl.source && decl.source.input && decl.source.input.file) || "";
    if (/[\\/]src[\\/](desktop|virtual)[\\/]/.test(file) || /node_modules/.test(file)) return;
    if (decl.__uipDone || !UNIT.test(decl.value)) { UNIT.lastIndex = 0; return; }
    UNIT.lastIndex = 0;
    decl.value = decl.value.replace(UNIT, (m, n, u) => {
      const axis = u.endsWith("w") ? "w" : "h";
      return `calc(${n} * var(--os-v${axis}, 1${u}))`;
    });
    decl.__uipDone = true;
  },
});
windowUnits.postcss = true;

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const target = env.VITE_API_TARGET || "https://uip-laravel.up.railway.app";
  const proxy = {
    "/api": { target, changeOrigin: true, secure: true },
    "/uploads": { target, changeOrigin: true, secure: true },
  };

  return {
    plugins: [react(), nativeHtml(mode)], // [ANDROID] nativeHtml is a no-op unless --mode native
    css: { postcss: { plugins: [windowUnits()] } },
    // The OS shell + editors are intentionally large and code-split by route; silence the 500 kB advisory.
    build: { chunkSizeWarningLimit: 2000 },
    server: { port: 5173, proxy },
    preview: { port: 4173, proxy },
  };
});
