/**
 * Local draft of a ZIP workbench session: unsaved edits, new / renamed / deleted files and the open tabs.
 * Only the delta is stored (edited texts + files created here), never the whole archive.
 *   sigOf(list)                   fingerprint of the archive the draft was made on
 *   snapshotDraft(parts)          -> plain object for IndexedDB
 *   restoreDraft(snap, base, bytes, sig) -> { map, edits, newData, origTexts, dirty, deletedCount, tabs, active, exact, count } | null
 * `exact` = the archive is the same one the draft started from, so renames / deletions are replayed too.
 * Otherwise (a newer version exists on the server) only text edits of files that still exist and files created here
 * are re-applied — the user's work is never silently dropped, and never overwrites structure changes of others.
 */
import { unzipSync } from 'fflate';

const dec = new TextDecoder('utf-8');

export function sigOf(nodes) {
  const s = nodes.map((n) => `${n.origPath ?? n.path}:${n.size}`).sort().join('|');
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `${nodes.length}:${(h >>> 0).toString(36)}`;
}

export function snapshotDraft({ vfs, edits, newData, deletedCount, tabs, active, sig }) {
  return {
    kind: 'zip', v: 1, sig,
    entries: [...vfs.values()].map((n) => ({ path: n.path, dir: !!n.dir, size: n.size, origPath: n.origPath ?? null, isNew: !!n.isNew })),
    edits: [...edits.entries()],
    newData: [...newData.entries()],
    deletedCount, tabs, active,
  };
}

export function restoreDraft(snap, baseMap, zipBytes, sig) {
  if (!snap || snap.kind !== 'zip' || !Array.isArray(snap.entries)) return null;
  const exact = snap.sig === sig;
  const map = new Map();
  const edits = new Map();
  const newData = new Map();
  let deletedCount = 0;
  const live = (p) => baseMap.has(p);

  if (exact) {
    snap.entries.forEach((e) => map.set(e.path, { path: e.path, dir: e.dir, size: e.size, origPath: e.origPath, isNew: e.isNew }));
    deletedCount = snap.deletedCount || 0;
    (snap.edits || []).forEach(([p, t]) => { if (map.has(p)) edits.set(p, t); });
    (snap.newData || []).forEach(([p, d]) => { if (map.has(p)) newData.set(p, d); });
  } else {
    baseMap.forEach((v, k) => map.set(k, v));
    (snap.entries || []).forEach((e) => {
      if (e.isNew && !e.dir && !map.has(e.path)) map.set(e.path, { path: e.path, dir: false, size: e.size, origPath: null, isNew: true });
    });
    (snap.edits || []).forEach(([p, t]) => { const n = map.get(p); if (n && !n.dir && (n.isNew || live(p))) edits.set(p, t); });
    (snap.newData || []).forEach(([p, d]) => { const n = map.get(p); if (n?.isNew) newData.set(p, d); });
  }

  // the original text of every edited, pre-existing file (so "edit back to the original" still clears the change mark)
  const origTexts = new Map();
  const need = new Set();
  edits.forEach((_t, p) => { const n = map.get(p); if (n && !n.isNew && n.origPath) need.add(n.origPath); });
  if (need.size) {
    const raw = unzipSync(zipBytes, { filter: (f) => need.has(f.name) });
    edits.forEach((_t, p) => { const n = map.get(p); if (n && !n.isNew && n.origPath) origTexts.set(p, dec.decode(raw[n.origPath] || new Uint8Array())); });
  }
  edits.forEach((_t, p) => { if (!origTexts.has(p)) origTexts.set(p, ''); });
  // edits identical to the original are not changes
  [...edits.entries()].forEach(([p, t]) => { if (origTexts.get(p) === t) edits.delete(p); });

  const dirty = new Set(edits.keys());
  let count = deletedCount;
  map.forEach((v) => { if (!v.dir && (v.isNew || v.path !== v.origPath || dirty.has(v.path))) count += 1; });
  const tabs = (snap.tabs || []).filter((p) => map.has(p) && !map.get(p).dir);
  const active = tabs.includes(snap.active) ? snap.active : tabs[tabs.length - 1] || null;
  return { map, edits, newData, origTexts, dirty, deletedCount, tabs, active, exact, count };
}
