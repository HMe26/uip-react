// Cloudflare Worker: serves the Vite build (dist/) as static assets and proxies
// /api/* and /uploads/* to the Laravel backend (same job netlify.toml / vercel.json do elsewhere).
// It also replaces middleware.js (Vercel-only): it forwards the real client IP signed with
// HMAC-SHA256 using the shared secret UIP_PROXY_SECRET
// (set it with: npx wrangler secret put UIP_PROXY_SECRET, or in the dashboard under Variables and Secrets).

const enc = new TextEncoder();

async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function proxy(request, env, url) {
  const headers = new Headers(request.headers);

  // Nothing coming from the browser is trusted.
  headers.delete("x-uip-client-ip");
  headers.delete("x-uip-proxy-ts");
  headers.delete("x-uip-proxy-sig");

  const ip = request.headers.get("cf-connecting-ip");
  if (env.UIP_PROXY_SECRET && ip && url.pathname.startsWith("/api/")) {
    const ts = String(Math.floor(Date.now() / 1000));
    headers.set("x-uip-client-ip", ip);
    headers.set("x-uip-proxy-ts", ts);
    headers.set("x-uip-proxy-sig", await hmacHex(env.UIP_PROXY_SECRET, `${ip}|${ts}`));
  }

  const target = new URL(url.pathname + url.search, env.API_ORIGIN);
  const upstream = await fetch(
    new Request(target, {
      method: request.method,
      headers,
      body: request.body,
      redirect: "manual",
    })
  );

  const res = new Response(upstream.body, upstream);

  // Uploaded PDFs are never rendered inline (same rule as netlify.toml / vercel.json).
  if (url.pathname.startsWith("/uploads/") && url.pathname.toLowerCase().endsWith(".pdf")) {
    res.headers.set("Content-Disposition", "attachment");
    res.headers.set("Content-Security-Policy", "sandbox; default-src 'none'");
    res.headers.set("X-Content-Type-Options", "nosniff");
  }
  return res;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/uploads/")) {
      return proxy(request, env, url);
    }
    return env.ASSETS.fetch(request);
  },
};
