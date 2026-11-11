const MAX_JSON_CHARS = 2_000_000;
let cache = { t: null, ok: false };
/** True when `t` is a JSON object / array small enough for the visual editor (single-entry cache: it is asked on every render). */
export function isEditableJson(t) {
  if (cache.t === t) return cache.ok;
  let ok = false;
  if (t.length < MAX_JSON_CHARS) { try { const v = JSON.parse(t); ok = v !== null && typeof v === 'object'; } catch { ok = false; } }
  cache = { t, ok };
  return ok;
}
