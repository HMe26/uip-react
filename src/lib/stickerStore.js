import { api } from '../api/client';

/**
 * Sticker / GIF data for the chat picker: personal library, favourites, recents, GIF search.
 * Everything is cached in memory so opening the picker again is instant; the network is only hit to refresh.
 */
const BASE = '/api/v1/messaging';
const RECENT_STICKERS = 'uip_sticker_recent_v2';
const RECENT_GIFS = 'uip_gif_recent_v2';
const MAX_RECENT = 30;

const read = (k) => { try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch { return []; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* not remembered */ } };

/** "/api/v1/messaging/attachments/12/file" -> 12 (a received / favourited sticker is an attachment). */
export const attachmentIdOf = (url) => {
  const m = /\/messaging\/attachments\/(\d+)\/file/.exec(String(url || ''));
  return m ? Number(m[1]) : null;
};
const libIdOf = (url) => {
  const m = /\/messaging\/stickers\/(\d+)\/file/.exec(String(url || ''));
  return m ? Number(m[1]) : null;
};

/** One sticker as the picker/ThreadPanel understand it: { key, url, kind:'image'|'video', libId?, attId? } */
export const toSticker = (x) => ({
  key: x.key || x.url,
  url: x.url,
  kind: x.kind === 'video' ? 'video' : 'image',
  libId: x.libId ?? libIdOf(x.url),
  attId: x.attId ?? attachmentIdOf(x.url),
});

export const getRecentStickers = () => read(RECENT_STICKERS).filter((s) => s && s.url && (s.libId || s.attId));
export const pushRecentSticker = (s) => {
  const item = toSticker(s);
  if (!item.libId && !item.attId) return;
  write(RECENT_STICKERS, [item, ...read(RECENT_STICKERS).filter((x) => x.key !== item.key)].slice(0, MAX_RECENT));
};
export const forgetRecentSticker = (key) => write(RECENT_STICKERS, read(RECENT_STICKERS).filter((x) => x.key !== key));

export const getRecentGifs = () => read(RECENT_GIFS).filter((g) => g && g.url);
export const pushRecentGif = (g) => write(RECENT_GIFS, [g, ...read(RECENT_GIFS).filter((x) => x.url !== g.url)].slice(0, MAX_RECENT));

/* ---- personal library ("ستيكراتي") ---- */
let mine = null;
export const cachedMyStickers = () => mine;
export async function loadMyStickers(force = false) {
  if (mine && !force) return mine;
  const res = await api.get(BASE + '/stickers');
  mine = (res.data || []).map((s) => toSticker({ key: `lib-${s.id}`, url: s.url, kind: s.kind, libId: s.id }));
  return mine;
}
export async function createMySticker(file, label) {
  const fd = new FormData();
  fd.append('sticker', file, file.name);
  if (label) fd.append('label', label);
  const res = await api.postForm(BASE + '/stickers', fd);
  const s = toSticker({ key: `lib-${res.data.id}`, url: res.data.url, kind: res.data.kind, libId: res.data.id });
  mine = [s, ...(mine || [])];
  return s;
}
export async function deleteMySticker(libId) {
  await api.del(BASE + '/stickers/' + libId);
  mine = (mine || []).filter((s) => s.libId !== libId);
  forgetRecentSticker(`lib-${libId}`);
}

/* ---- favourites (stickers + GIFs) ---- */
let favs = null;
export const cachedFavourites = () => favs;
export async function loadFavouriteItems(force = false) {
  if (favs && !force) return favs;
  const res = await api.get(BASE + '/favourites/stickers');
  const rows = res.data || [];
  favs = {
    stickers: rows.filter((r) => r.kind !== 'gif').map((r) => toSticker({ key: r.item_key, url: r.url })),
    gifs: rows.filter((r) => r.kind === 'gif').map((r) => ({ url: r.url, preview: r.url, title: r.label || '' })),
  };
  return favs;
}
export async function removeFavouriteSticker(key) {
  await api.del(BASE + '/favourites/stickers/' + key);
  if (favs) favs = { ...favs, stickers: favs.stickers.filter((s) => s.key !== key) };
}
export const invalidateFavourites = () => { favs = null; };

/* ---- GIF search (Giphy through the API; needs GIPHY_API_KEY on the server) ---- */
const gifCache = new Map();
export async function searchGifs(q, offset = 0) {
  const key = `${q}|${offset}`;
  if (gifCache.has(key)) return gifCache.get(key);
  const res = await api.get(BASE + '/gifs', { q, offset });
  gifCache.set(key, res.data);
  if (gifCache.size > 60) gifCache.delete(gifCache.keys().next().value);
  return res.data;
}

/* ---- platform policy (Admin → Chat Media): which GIF / sticker features this person's portal may use ---- */
const OPEN_POLICY = { gifs: { enabled: true, search: true, trending: true, configured: true }, stickers: { enabled: true, can_create: true, packs: true, allow_video: true } };
let mediaPolicy = null;
let mediaPolicyAt = 0;
export const cachedMediaPolicy = () => mediaPolicy || OPEN_POLICY;
export async function loadMediaPolicy(force = false) {
  if (mediaPolicy && !force && Date.now() - mediaPolicyAt < 60000) return mediaPolicy;
  try {
    const res = await api.get(BASE + '/media-policy');
    mediaPolicy = res.data || OPEN_POLICY;
    mediaPolicyAt = Date.now();
  } catch { /* offline / old server: keep everything visible, the server still enforces */ }
  return mediaPolicy || OPEN_POLICY;
}

/* ---- sticker packs (my own groups of stickers) ---- */
let packs = null;
export const cachedPacks = () => packs;
const srcBody = (src) => (src?.libId ? { sticker_id: src.libId } : src?.attId ? { attachment_id: src.attId } : {});
const setPacks = (list) => { packs = list || []; return packs; };
export async function loadPacks(force = false) {
  if (packs && !force) return packs;
  const res = await api.get(BASE + '/sticker-packs');
  return setPacks(res.data);
}
/** Where does this sticker live? -> { sticker_id, pack_ids } (src: { libId } | { attId }) */
export async function stickerState(src) {
  const q = src?.libId ? { sticker_id: src.libId } : { attachment_id: src?.attId };
  const res = await api.get(BASE + '/stickers/lookup', q);
  return res.data || { sticker_id: null, pack_ids: [] };
}
export async function createPack(name, src) {
  const res = await api.post(BASE + '/sticker-packs', { name, ...srcBody(src) });
  setPacks(res.data.packs);
  loadMyStickers(true).catch(() => {}); // a received sticker was copied into the library
  return res.data; // { pack_id, sticker_id, packs }
}
export async function addToPack(packId, src) {
  const res = await api.post(BASE + `/sticker-packs/${packId}/items`, srcBody(src));
  setPacks(res.data.packs);
  loadMyStickers(true).catch(() => {});
  return res.data; // { sticker_id, packs }
}
export async function removeFromPack(packId, stickerId) {
  const res = await api.del(BASE + `/sticker-packs/${packId}/items/${stickerId}`);
  return setPacks(res.data);
}
export async function renamePack(packId, name) {
  const res = await api.patch(BASE + `/sticker-packs/${packId}`, { name });
  return setPacks(res.data);
}
export async function deletePack(packId) {
  const res = await api.del(BASE + `/sticker-packs/${packId}`);
  return setPacks(res.data);
}
export async function loadPack(packId) {
  const res = await api.get(BASE + `/sticker-packs/${packId}`);
  return { ...res.data, items: (res.data.items || []).map((s) => toSticker({ key: `lib-${s.id}`, url: s.url, kind: s.kind, libId: s.id })) };
}
