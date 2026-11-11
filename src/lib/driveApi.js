import { api } from '../api/client';
import { getDraft, pruneCache, putDraft } from './draftStore';
import { emitDriveFailed, emitDriveSaved } from './driveEvents';
import { trackDelete } from './deleteProgress';

/**
 * "My PC" (جهازي) client — thin wrappers over /api/v1/drive/* (App\Http\Controllers\Api\DriveApiController).
 * Every file is private: bytes come through authenticated requests (api.blob = Bearer + refresh-on-401), never a public URL.
 */
const B = '/api/v1/drive';


const unwrap = (r) => (r && r.data !== undefined ? r.data : r);

/**
 * Server switch (GET /drive/config). When My PC lives on S3 / Cloudflare R2 the browser uploads and downloads STRAIGHT to the bucket
 * through short-lived signed URLs and Laravel only stores metadata (docs/DRIVE_CLOUD_STORAGE.md). Any network / CORS failure on the
 * bucket side falls back to the classic proxied path, so saving is never blocked by the direct route.
 */
let cfgP = null;
export function driveConfig(force = false) {
  if (!cfgP || force) {
    cfgP = api.get(`${B}/config`).then(unwrap).catch(() => {
      setTimeout(() => { cfgP = null; }, 60 * 1000); // ask again in a minute
      return { direct_upload: false, max_file_mb: 100, cloud: {} };
    });
  }
  return cfgP;
}
const directOn = async () => !!(await driveConfig()).direct_upload;

/** Errors that mean "the direct route is unusable here" (not "your save is wrong"): use the classic path instead. */
const canFallBack = (e) => !e?.status || e.status === 0 || e.status === 404 || e.status === 405 || e.status >= 500 || e?.direct === true;

async function sha1Hex(blob) {
  try {
    if (!globalThis.crypto?.subtle || blob.size > 64 * 1024 * 1024) return null;
    const d = await crypto.subtle.digest('SHA-1', await blob.arrayBuffer());
    return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch { return null; }
}

/** PUT the bytes to a signed URL with progress. Rejects with { direct: true } on any bucket-side problem. */
function putToBucket(put, blob, onProgress, signal) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('PUT', put.url);
    Object.entries(put.headers || {}).forEach(([k, v]) => { try { x.setRequestHeader(k, Array.isArray(v) ? v[0] : v); } catch { /* forbidden header */ } });
    x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(Math.min(99, Math.round((e.loaded / e.total) * 100))); };
    x.onload = () => (x.status >= 200 && x.status < 300 ? resolve() : reject(Object.assign(new Error(`Storage answered ${x.status}.`), { direct: true, status: x.status })));
    x.onerror = () => reject(Object.assign(new Error('Could not reach the storage.'), { direct: true }));
    x.onabort = () => reject(Object.assign(new Error('Upload cancelled.'), { name: 'AbortError' }));
    if (signal) { if (signal.aborted) { x.abort(); return; } signal.addEventListener('abort', () => x.abort(), { once: true }); }
    x.send(blob);
  });
}

async function directUpload(parentId, file, rel, onProgress, signal) {
  const init = unwrap(await api.post(`${B}/upload/init`, {
    parent_id: parentId || null, name: file.name, size: file.size, mime: file.type || null, path: rel && rel.includes('/') ? rel : null,
  }));
  await putToBucket(init.put, file, onProgress, signal);
  const node = unwrap(await api.post(`${B}/upload/complete`, { token: init.token }));
  onProgress?.(100);
  return { success: true, data: { items: [node], failed: [] } };
}

async function directReplace(id, blob, name) {
  const init = unwrap(await api.post(`${B}/nodes/${id}/replace/init`, { size: blob.size, mime: blob.type || null }));
  await putToBucket(init.put, blob);
  const node = unwrap(await api.post(`${B}/nodes/${id}/replace/complete`, { token: init.token, name: name || null, sha1: await sha1Hex(blob) }));
  return { success: true, data: node };
}

export const drive = {
  list: (parentId) => api.get(B, parentId ? { parent_id: parentId } : undefined),
  tree: () => api.get(`${B}/tree`),
  search: (q) => api.get(`${B}/search`, { q }),
  /** Storage monitor: categories, largest files / folders, recycle bin, old versions, duplicates. */
  storage: () => api.get(`${B}/storage`).then(unwrap),
  /** Delete every old version (version history) to free space. */
  clearVersions: () => api.del(`${B}/versions`).then(unwrap),
  /** Live data for items by id (desktop shortcuts): { items, gone } — `gone` = deleted for good. */
  resolve: (ids) => api.get(`${B}/resolve`, { ids: ids.join(',') }),
  /** Search inside the text of files: { items: [{ …node, path, matches: [{ line, text, start, len }], match_count }], pending } */
  searchContent: (q) => api.get(`${B}/search-content`, { q }),
  usage: () => api.get(`${B}/usage`),
  /** Disks: top-level folders marked as drives, with the space each one uses. */
  disks: () => api.get(`${B}/disks`).then(unwrap),
  createDisk: (name) => api.post(`${B}/disks`, { name }),
  /** Turn a top-level folder into a disk (enabled = true) or back into a normal folder. */
  setDisk: (id, enabled) => api.post(`${B}/nodes/${id}/disk`, { enabled }),
  trashList: () => api.get(`${B}/trash`),
  createFolder: (parentId, name) => api.post(`${B}/folders`, { parent_id: parentId || null, name }),
  /** mkdir -p "a/b/c" under parentId */
  ensurePath: (parentId, path) => api.post(`${B}/folders`, { parent_id: parentId || null, path }),
  createFile: (parentId, name, content = '') => api.post(`${B}/files`, { parent_id: parentId || null, name, content }),
  createProject: (parentId, name, template) => api.post(`${B}/projects`, { parent_id: parentId || null, name, template }),
  rename: (id, name) => api.patch(`${B}/nodes/${id}`, { name }),
  move: (ids, targetId) => api.post(`${B}/move`, { ids, target_id: targetId || null }),
  copy: (ids, targetId) => api.post(`${B}/copy`, { ids, target_id: targetId || null }),
  zip: (ids, parentId, name) => api.post(`${B}/zip`, { ids, parent_id: parentId || null, name }),
  unzip: (id, parentId) => api.post(`${B}/nodes/${id}/unzip`, { parent_id: parentId || null }),
  trash: (ids) => trackDelete('trash', ids.length, api.post(`${B}/trash`, { ids })),
  restore: (ids) => api.post(`${B}/restore`, { ids }),
  purge: (ids) => trackDelete('purge', ids.length, api.post(`${B}/purge`, { ids })),
  emptyTrash: () => trackDelete('empty', 0, api.del(`${B}/trash`)),
  /** Save a file's new bytes (image / PDF / ZIP editors, or a text file from the code editor). opts.silent = no "Saved" toast / backup trigger. */
  replace: async (id, blob, name, opts) => {
    let res = null;
    if (await directOn()) {
      try { res = await directReplace(id, blob, name); } catch (e) { if (!canFallBack(e)) throw e; }
    }
    if (!res) {
      const fd = new FormData();
      fd.append('file', new File([blob], name || 'file', { type: blob.type || 'application/octet-stream' }));
      if (name) fd.append('name', name);
      res = await api.postForm(`${B}/nodes/${id}/replace`, fd);
    }
    if (!opts?.silent) emitDriveSaved({ id, name: unwrap(res)?.name || name || '', kind: 'replace', size: blob.size });
    return res;
  },
  /** Save the code editor's ZIP back into its folder (changed → replaced, new → added, removed → recycle bin). */
  sync: (id, blob, opts) => {
    const fd = new FormData();
    fd.append('file', new File([blob], 'folder.zip', { type: 'application/zip' }));
    (opts?.preserve || []).forEach((n) => fd.append('preserve[]', n)); // folders missing from the ZIP on purpose (node_modules…): keep them in My PC
    return api.postForm(`${B}/nodes/${id}/sync`, fd).then((r) => { emitDriveSaved({ id, name: '', kind: 'sync', size: blob.size }); return r; });
  },
  /** One file per request (clear progress, parallel-safe). rel = "dir/sub/file.txt" when uploading a folder. */
  upload: async (parentId, file, rel, onProgress, signal) => {
    let res = null;
    try {
      if (await directOn()) {
        try { res = await directUpload(parentId, file, rel, onProgress, signal); } catch (e) { if (e?.name === 'AbortError' || !canFallBack(e)) throw e; }
      }
      if (!res) {
        const fd = new FormData();
        if (parentId) fd.append('parent_id', String(parentId));
        fd.append('files[]', file, file.name);
        if (rel && rel.includes('/')) fd.append('paths[]', rel);
        res = await api.postFormProgress(`${B}/upload`, fd, onProgress, signal);
      }
    } catch (e) {
      if (e?.name !== 'AbortError') emitDriveFailed({ name: file.name, kind: 'upload', message: e?.message || '' }); // a cancelled upload is not a failure
      throw e;
    }
    emitDriveSaved({ id: unwrap(res)?.items?.[0]?.id, name: file.name, kind: 'upload', size: file.size });
    return res;
  },
  /** Share links (GET/POST /drive/nodes/{id}/shares, PATCH/DELETE /drive/shares/{id}). expiry: '1d' | '7d' | '30d' | 'never' or a custom '<n>m' | '<n>h' | '<n>d' (e.g. '5m', 2h). */
  shares: (id) => api.get(`${B}/nodes/${id}/shares`).then(unwrap),
  mySharedLinks: () => api.get(`${B}/shares`).then(unwrap),
  /** requireInfo = the visitor must type name + email + mobile before opening; password = optional link password. */
  createShare: (id, { expiry, canDownload, requireInfo, password, singlePerson, oneTime, access }) => api.post(`${B}/nodes/${id}/shares`, {
    expiry, can_download: !!canDownload, require_visitor_info: !!requireInfo, single_person: !!singlePerson, one_time: !!oneTime,
    ...(oneTime && access ? { access } : {}), ...(password ? { password } : {}),
  }).then(unwrap),
  /** One link for several files / folders: POST /drive/shares/bundle. ids = My PC node ids, title = name the visitor sees (optional). */
  createBundleShare: (ids, { title, expiry, canDownload, requireInfo, password, singlePerson, oneTime, access }) => api.post(`${B}/shares/bundle`, {
    node_ids: ids, ...(title ? { title } : {}),
    expiry, can_download: !!canDownload, require_visitor_info: !!requireInfo, single_person: !!singlePerson, one_time: !!oneTime,
    ...(oneTime && access ? { access } : {}), ...(password ? { password } : {}),
  }).then(unwrap),
  /** patch: { expiry?, can_download?, require_visitor_info?, single_person?, one_time?, access? ('10m' | '2h' | '1d'), password?, remove_password? } */
  updateShare: (shareId, patch) => api.patch(`${B}/shares/${shareId}`, patch).then(unwrap),
  revokeShare: (shareId) => api.del(`${B}/shares/${shareId}`),
  /** "My shared links" page: every link (active / paused / expired / turned off) with visitor counts. */
  manageShares: () => api.get(`${B}/shares/manage`).then(unwrap),
  /** Who opened one link: { share, summary, visitors, events }. */
  shareActivity: (shareId) => api.get(`${B}/shares/${shareId}/activity`).then(unwrap),
  clearShareActivity: (shareId) => api.del(`${B}/shares/${shareId}/activity`),
  /** Bulk on my links: action 'pause' | 'resume' | 'delete', with ids: number[] or all: true -> { done, skipped }. */
  bulkShares: (action, { ids = [], all = false } = {}) => api.post(`${B}/shares/bulk`, { action, ids, all }).then(unwrap),
  /** Single-person / one-time link: forget the browser it was bound to (and restart the one-time window). */
  resetShareClaim: (shareId) => api.post(`${B}/shares/${shareId}/reset-claim`, {}).then(unwrap),
  pauseShare: (shareId) => api.post(`${B}/shares/${shareId}/pause`, {}).then(unwrap),
  resumeShare: (shareId) => api.post(`${B}/shares/${shareId}/resume`, {}).then(unwrap),
  /** Delete the link and its whole log for good. */
  deleteShare: (shareId) => api.del(`${B}/shares/${shareId}/forever`),
  /** Version history of a file: the old copies kept before every save (newest first) — GET /nodes/{id}/versions → { node, items, limit }. */
  versions: (id) => api.get(`${B}/nodes/${id}/versions`).then(unwrap),
  /** Bytes of one old version (private, authenticated). */
  versionBlob: async (id, versionId) => (await api.blob(`${B}/nodes/${id}/versions/${versionId}/content`)).blob(),
  /** Put the file back to an old version (the current content is kept as a new version, so it can be undone). */
  restoreVersion: (id, versionId) => api.post(`${B}/nodes/${id}/versions/${versionId}/restore`, {}).then(unwrap),
  deleteVersion: (id, versionId) => api.del(`${B}/nodes/${id}/versions/${versionId}`),
  /** Whole-tree listing (metadata only) for the cloud backup engine. */
  manifest: () => api.get(`${B}/manifest`).then(unwrap),
  /** "My Library" preferences kept on the server so they follow the person across devices: { marks, library, updated_at } (a section is null until first saved). */
  libraryState: () => api.get(`${B}/library-state`).then(unwrap),
  /** Replaces only the section(s) sent: { marks } and/or { library }. */
  saveLibraryState: (body) => api.put(`${B}/library-state`, body).then(unwrap),
  sandboxTokenPath: (folderId) => `${B}/nodes/${folderId}/sandbox-token`,
};

const CACHE_MAX_BYTES = 40 * 1024 * 1024;
async function readWithProgress(res, onProgress) {
  const total = Number(res.headers.get('content-length')) || 0;
  const type = res.headers.get('content-type') || '';
  if (!res.body || !res.body.getReader || !onProgress) return res.blob();
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    if (total) onProgress(Math.min(99, Math.round((got / total) * 100)));
  }
  return new Blob(chunks, { type });
}

// bytes we already hold (a file this device just created): the first open uses them instead of downloading them back from the server
const primed = new Map();
export function primeBlob(id, blob) {
  if (id == null || !blob) return;
  const k = String(id); primed.set(k, blob);
  setTimeout(() => { if (primed.get(k) === blob) primed.delete(k); }, 120000);
}

/** A file's bytes (private → authenticated request; with direct storage: a signed bucket URL, validated against the local copy first). */
export async function fetchDriveBlob(id, { onProgress } = {}) {
  const hit = primed.get(String(id));
  if (hit) { primed.delete(String(id)); onProgress?.(100); return hit; } // single use: later opens revalidate against the server as usual
  const key = `blob:drive:${id}`;
  const cached = await getDraft(key); // { etag, blob } from an earlier open (IndexedDB)
  const have = cached?.kind === 'cache' && cached.blob && cached.etag ? cached : null;

  if (await directOn()) {
    try {
      const info = unwrap(await api.get(`${B}/nodes/${id}/download-url`));
      if (have && info.etag === have.etag) { onProgress?.(100); return have.blob; }
      let res;
      try { res = await fetch(info.url, { credentials: 'omit' }); } catch (fe) { throw Object.assign(fe, { direct: true }); }
      if (!res.ok) throw Object.assign(new Error(`Storage answered ${res.status}.`), { direct: true });
      const blob = await readWithProgress(res, onProgress);
      if (info.etag && blob.size <= CACHE_MAX_BYTES) { putDraft(key, { kind: 'cache', etag: info.etag, blob }); pruneCache(); }
      return blob;
    } catch (e) {
      if (have && e?.status === 0) { onProgress?.(100); return have.blob; } // offline (the API itself is unreachable): use the local copy
      if (!canFallBack(e)) throw e;
      // otherwise: the classic proxied download below
    }
  }

  let res;
  try {
    res = await api.blob(`${B}/nodes/${id}/content`, undefined, have ? { 'If-None-Match': have.etag } : undefined);
  } catch (e) {
    if (have && (e?.status === 304 || e?.status === 0)) { onProgress?.(100); return have.blob; } // unchanged — or offline: use the local copy
    throw e;
  }
  const blob = await readWithProgress(res, onProgress);
  const etag = res.headers.get('etag');
  if (etag && blob.size <= CACHE_MAX_BYTES) { putDraft(key, { kind: 'cache', etag, blob }); pruneCache(); }
  return blob;
}

/** A folder as a ZIP with its contents at the archive root (what the code editor opens). */
export async function fetchFolderZip(id, { onProgress } = {}) {
  const res = await api.blob(`${B}/nodes/${id}/archive`, { root: 1 });
  return readWithProgress(res, onProgress);
}

/** Everything on My PC as one ZIP (backup before "Reset this PC"). */
export async function fetchBackupAll({ onProgress } = {}) {
  const res = await api.blob(`${B}/archive-all`);
  return readWithProgress(res, onProgress);
}

/** Download a file / folder (folders as ZIP) through the blob so the login token is sent. */
export async function fetchDownload(node, opts) {
  if (node.type === 'folder') {
    const res = await api.blob(`${B}/nodes/${node.id}/archive`);
    return { blob: await readWithProgress(res, opts?.onProgress), name: `${node.name}.zip` };
  }
  return { blob: await fetchDriveBlob(node.id, opts), name: node.name };
}

/** Public share page (no login): /api/v1/public/drive-share/{token}. */
const P = (token) => `/api/v1/public/drive-share/${encodeURIComponent(token)}`;

// This device remembers the visitor, so the gate is not asked again on every visit:
//  - the gate session (issued after the name/email/phone and/or the password) is kept in localStorage per link and is sent
//    on every request in X-Share-Session. The server still drops it when the owner changes the password / the link's settings;
//  - the details the visitor typed (never the password) pre-fill the form if the gate does come back;
//  - a random per-device secret (X-Share-Client) is what "one person only" / "one time" links are bound to. Only its hash is stored.
const SK = (token) => `shp:${token}`;
const ls = {
  get: (k) => { try { return window.localStorage.getItem(k) || ''; } catch { return ''; } },
  set: (k, v) => { try { window.localStorage.setItem(k, v); } catch { /* private mode */ } },
  del: (k) => { try { window.localStorage.removeItem(k); } catch { /* ignore */ } },
};
export const shareSession = {
  get: (token) => ls.get(SK(token)) || (() => { try { return window.sessionStorage.getItem(SK(token)) || ''; } catch { return ''; } })(),
  set: (token, v) => { ls.set(SK(token), v); },
  clear: (token) => { ls.del(SK(token)); try { window.sessionStorage.removeItem(SK(token)); } catch { /* ignore */ } },
};
export const shareVisitor = {
  get: () => { try { const v = JSON.parse(ls.get('shv') || 'null'); return v && typeof v === 'object' ? { name: String(v.name || ''), email: String(v.email || ''), phone: String(v.phone || '') } : null; } catch { return null; } },
  set: ({ name, email, phone }) => ls.set('shv', JSON.stringify({ name: name || '', email: email || '', phone: phone || '' })),
};
export const shareClient = () => {
  let v = ls.get('shc');
  if (!/^[A-Za-z0-9]{32,64}$/.test(v)) {
    const buf = new Uint8Array(24);
    try { crypto.getRandomValues(buf); } catch { buf.forEach((_, i) => { buf[i] = Math.floor(Math.random() * 256); }); }
    v = Array.from(buf, (n) => n.toString(16).padStart(2, '0')).join('');
    ls.set('shc', v);
  }
  return v;
};
/** confirm = the visitor pressed "Open" on a one-person / one-time link (this is what binds the link to this browser). */
const gateHeaders = (token, confirm = false) => {
  const v = shareSession.get(token);
  return { 'X-Share-Client': shareClient(), ...(v ? { 'X-Share-Session': v } : {}), ...(confirm ? { 'X-Share-Confirm': '1' } : {}) };
};

export const sharedApi = {
  view: (token, nodeId, { confirm = false } = {}) => api.get(P(token), nodeId ? { node: nodeId } : undefined, gateHeaders(token, confirm)).then(unwrap),
  /** Gate: { name, email, phone, password } → { session, visitor_name }. Throws with err.data (errors.code / fields) on a wrong password etc. */
  enter: (token, body) => api.post(`${P(token)}/enter`, body, gateHeaders(token)).then(unwrap),
  file: async (token, nodeId, { download = false } = {}) => {
    const res = await api.blob(`${P(token)}/file`, { ...(nodeId ? { node: nodeId } : {}), ...(download ? { download: 1 } : {}) }, gateHeaders(token));
    return res.blob();
  },
  zip: async (token, nodeId) => {
    const res = await api.blob(`${P(token)}/zip`, nodeId ? { node: nodeId } : undefined, gateHeaders(token));
    return res.blob();
  },
};
