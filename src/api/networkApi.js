import { api } from './client';
import { postsApi } from './postsApi';

const N = '/api/v1/network';
const d = (r) => r.data;
const list = (r) => ({ items: r.data || [], meta: r.meta || {} });

/** "My network" API (/api/v1/network/*). Action calls resolve the person's fresh relation ({ connection, connection_id, is_following, ... }). */
export const networkApi = {
  summary: () => api.get(`${N}/summary`).then(d),
  settings: () => api.get(`${N}/settings`).then(d),
  saveSettings: (body) => api.patch(`${N}/settings`, body).then(d),

  connections: (q, page = 1) => api.get(`${N}/connections`, { q: q || undefined, page }).then(list),
  requests: (direction, page = 1) => api.get(`${N}/requests`, { direction, page }).then(list),
  followRequests: (page = 1) => api.get(`${N}/follow-requests`, { page }).then(list),
  followers: (q, page = 1) => api.get(`${N}/followers`, { q: q || undefined, page }).then(list),
  following: (q, page = 1) => api.get(`${N}/following`, { q: q || undefined, page }).then(list),
  search: (params, page = 1) => api.get(`${N}/search`, { ...params, page }).then(list),
  suggestions: (limit = 12) => api.get(`${N}/suggestions`, { limit }).then(d),
  person: (id) => api.get(`${N}/people/${id}`).then(d),
  /** A person's friends (connections) — the profile "Friends" tab. Each item carries MY relation to that friend. */
  friendsOf: (id, q, page = 1) => api.get(`${N}/people/${id}/connections`, { q: q || undefined, page }).then(list),
  /** Cover photo (multipart `cover`). */
  setCover: (file) => { const fd = new FormData(); fd.append('cover', file, file.name); return api.postForm(`${N}/me/cover`, fd).then(d); },
  removeCover: () => api.del(`${N}/me/cover`).then(d),

  connect: (id, message) => api.post(`${N}/connect/${id}`, message ? { message } : {}).then(d),
  accept: (requestId) => api.post(`${N}/requests/${requestId}/accept`).then(d),
  decline: (requestId) => api.post(`${N}/requests/${requestId}/decline`).then(d),
  withdraw: (requestId) => api.del(`${N}/requests/${requestId}`).then(d),
  removeConnection: (userId) => api.del(`${N}/connections/${userId}`).then(d),
  acceptFollow: (userId) => api.post(`${N}/follow-requests/${userId}/accept`).then(d),
  declineFollow: (userId) => api.post(`${N}/follow-requests/${userId}/decline`).then(d),
  removeFollower: (userId) => api.del(`${N}/followers/${userId}`).then(d),

  follow: (userId) => postsApi.follow(userId),
  unfollow: (userId) => postsApi.unfollow(userId),

  /** Finds or creates the direct chat with this person and resolves its conversation id (the Messages page opens it by id). */
  openChat: (userId) => api.post('/api/v1/messaging/conversations/direct', { recipient_id: userId, body: '' }).then((r) => r.data?.conversation?.id),
};
