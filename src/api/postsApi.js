import { api } from './client';
import { uploadChunked, CHUNKED_MIN_BYTES, forgetUpload } from '../lib/chunkedUpload';

const P = '/api/v1/posts';
const A = '/api/v1/posts-admin';
const d = (r) => r.data;

/** Social posts API (/api/v1/posts/*, admin: /api/v1/posts-admin/*). Every call resolves with the unwrapped `data`; list calls resolve { items, meta }. */
export const postsApi = {
  config: () => api.get(`${P}/config`).then(d),
  feed: (params) => api.get(`${P}/feed`, params).then((r) => ({ items: r.data || [], meta: r.meta || {} })),
  one: (id) => api.get(`${P}/${id}`).then(d),
  create: (body) => api.post(P, body).then(d),
  update: (id, body) => api.patch(`${P}/${id}`, body).then(d),
  remove: (id) => api.del(`${P}/${id}`),
  publish: (id) => api.post(`${P}/${id}/publish`).then(d),
  archive: (id) => api.post(`${P}/${id}/archive`),
  unarchive: (id) => api.post(`${P}/${id}/unarchive`),
  pin: (id) => api.post(`${P}/${id}/pin`),
  unpin: (id) => api.post(`${P}/${id}/unpin`),

  react: (id, type) => api.post(`${P}/${id}/react`, { type }).then(d),
  reactors: (id, type, page = 1) => api.get(`${P}/${id}/reactions`, { type, page }).then(d),
  sharers: (id, kind = 'all', page = 1) => api.get(`${P}/${id}/shares`, { kind, page }).then(d),
  viewers: (id, page = 1) => api.get(`${P}/${id}/viewers`, { page }).then(d),
  save: (id) => api.post(`${P}/${id}/save`).then(d),
  saveTo: (id, collection_id = null) => api.post(`${P}/${id}/save`, { action: 'save', collection_id }).then(d),
  unsave: (id) => api.post(`${P}/${id}/save`, { action: 'unsave' }).then(d),
  collections: () => api.get(`${P}/collections`).then(d),
  createCollection: (name) => api.post(`${P}/collections`, { name }).then(d),
  renameCollection: (id, name) => api.patch(`${P}/collections/${id}`, { name }).then(d),
  deleteCollection: (id) => api.del(`${P}/collections/${id}`),
  repost: (id, body) => api.post(`${P}/${id}/repost`, { body }).then(d),
  share: (id, channel = 'link') => api.post(`${P}/${id}/share`, { channel }).then(d),
  view: (id, dwell_ms, completed = false) => api.postQuiet(`${P}/${id}/view`, { dwell_ms, completed }),
  hide: (id, reason) => api.post(`${P}/${id}/hide`, { reason }),
  unhide: (id) => api.del(`${P}/${id}/hide`),
  report: (id, reason, details, comment_id) => api.post(`${P}/${id}/report`, { reason, details, comment_id }),

  comments: (id, sort = 'new', page = 1) => api.get(`${P}/${id}/comments`, { sort, page }).then((r) => ({ items: r.data || [], meta: r.meta || {} })),
  replies: (commentId, page = 1) => api.get(`${P}/comments/${commentId}/replies`, { page }).then((r) => ({ items: r.data || [], meta: r.meta || {} })),
  addComment: (id, body, parent_id) => api.post(`${P}/${id}/comments`, { body, parent_id }).then(d),
  editComment: (cid, body) => api.patch(`${P}/comments/${cid}`, { body }).then(d),
  deleteComment: (cid) => api.del(`${P}/comments/${cid}`),
  likeComment: (cid) => api.post(`${P}/comments/${cid}/like`).then(d),
  /** type: like | love | insightful | celebrate | support | funny — null removes my reaction. */
  reactComment: (cid, type) => api.post(`${P}/comments/${cid}/react`, { type: type || null }).then(d),

  trendingTags: (limit = 12) => api.get(`${P}/tags/trending`, { limit }).then(d),
  suggestTags: (q) => api.get(`${P}/tags/suggest`, { q }).then(d),
  suggestions: (limit = 8) => api.get(`${P}/people/suggestions`, { limit }).then(d),
  profile: (uid) => api.get(`${P}/profile/${uid}`).then(d),
  follow: (uid) => api.post(`${P}/follow/${uid}`).then(d),
  unfollow: (uid) => api.del(`${P}/follow/${uid}`).then(d),
  mute: (uid) => api.post(`${P}/authors/${uid}/mute`),
  unmute: (uid) => api.del(`${P}/authors/${uid}/mute`),

  mediaText: (id, base = `${P}/media`) => api.get(`${base}/${id}/text`).then(d),
  /** Public post page (no sign-in): only visibility=public posts; anything else is a 404. */
  publicPost: (id) => api.get(`/api/v1/public/posts/${id}`).then(d),
  publicComments: (id, page = 1) => api.get(`/api/v1/public/posts/${id}/comments`, { page }).then((r) => ({ items: r.data || [], meta: r.meta || {} })),
  deleteMedia: (id) => api.del(`${P}/media/${id}`),
  /** Small files: one multipart request. Big files (>= 4 MB): 3 MB pieces via the shared chunked-upload service, then POST /media {upload_id}. */
  async uploadMedia(file, { onProgress, signal } = {}) {
    if (file.size >= CHUNKED_MIN_BYTES) {
      const uploadId = await uploadChunked(file, { base: '/api/v1/messaging', signal, onProgress: (sent) => onProgress?.(Math.round((sent / file.size) * 100)) });
      const out = await api.post(`${P}/media`, { upload_id: uploadId }).then(d);
      forgetUpload(file);
      return out;
    }
    const fd = new FormData();
    fd.append('file', file, file.name);
    return api.postFormProgress(`${P}/media`, fd, onProgress, signal).then(d);
  },

  admin: {
    stats: () => api.get(`${A}/stats`).then(d),
    settings: () => api.get(`${A}/settings`).then(d),
    saveSettings: (settings) => api.put(`${A}/settings`, { settings }).then(d),
    reports: (status = 'pending', page = 1) => api.get(`${A}/reports`, { status, page }).then((r) => ({ items: r.data || [], meta: r.meta || {} })),
    resolve: (id, action) => api.post(`${A}/reports/${id}/resolve`, { action }),
    pending: (page = 1) => api.get(`${A}/pending`, { page }).then((r) => ({ items: r.data || [], meta: r.meta || {} })),
    approve: (id) => api.post(`${A}/${id}/approve`),
    reject: (id, reason) => api.post(`${A}/${id}/reject`, { reason }),
  },
};
