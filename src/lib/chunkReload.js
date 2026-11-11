// A deploy renames every hashed JS chunk. A tab opened before the deploy then asks for a file
// that no longer exists, the host answers with index.html, and the lazy import fails. A reload
// fetches the new index.html and fixes it, so we do that once automatically.
const KEY = 'uip_chunk_reload_at';
const WINDOW_MS = 15000; // never reload twice within this window (avoids a reload loop)

export function isChunkLoadError(err) {
  const msg = String((err && (err.message || err)) || '');
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS|ChunkLoadError|Loading chunk [\w-]+ failed|MIME type/i.test(msg);
}

/** Reloads the page once. Returns true if a reload was triggered. */
export function reloadOnceForChunkError() {
  try {
    const last = Number(sessionStorage.getItem(KEY) || 0);
    if (Date.now() - last < WINDOW_MS) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    return false; // storage blocked: can't guard against a loop, so don't auto-reload
  }
  window.location.reload();
  return true;
}
