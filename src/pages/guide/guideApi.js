import { api } from '../../api/client';

/**
 * Thin wrapper over the Portal Guides API (see backend PORTAL_GUIDE_API.md).
 *   read  : /api/v1/guides/*            (every signed-in user: own portal; guides.manage: any portal)
 *   write : /api/v1/admin/guides/*      (guides.manage only)
 * Every call resolves to the `data` of the {success,message,data,errors,meta} envelope.
 */
const READ = '/api/v1/guides';
const WRITE = '/api/v1/admin/guides';
const data = (json) => json?.data;

export const guideApi = {
  list: () => api.get(READ).then(data),
  me: () => api.get(`${READ}/me`).then(data),
  get: (portal, includeHidden = false) =>
    api.get(`${READ}/${portal}`, includeHidden ? { include_hidden: 1 } : undefined).then(data),
  seen: (portal) => api.post(`${READ}/${portal}/seen`, {}).then(data),

  updateMeta: (portal, body) => api.put(`${WRITE}/portal/${portal}`, body).then(data),
  createSection: (portal, body) => api.post(`${WRITE}/portal/${portal}/sections`, body).then(data),
  reorderSections: (portal, ids) => api.post(`${WRITE}/portal/${portal}/sections/reorder`, { ids }).then(data),
  revisions: (portal, limit = 60) => api.get(`${WRITE}/portal/${portal}/revisions`, { limit }).then(data),
  reset: (portal) => api.post(`${WRITE}/portal/${portal}/reset`, {}).then(data),
  restore: (revisionId) => api.post(`${WRITE}/revisions/${revisionId}/restore`, {}).then(data),

  updateSection: (id, body) => api.put(`${WRITE}/sections/${id}`, body).then(data),
  deleteSection: (id) => api.del(`${WRITE}/sections/${id}`).then(data),
  createItem: (sectionId, body) => api.post(`${WRITE}/sections/${sectionId}/items`, body).then(data),
  reorderItems: (sectionId, ids) => api.post(`${WRITE}/sections/${sectionId}/items/reorder`, { ids }).then(data),

  updateItem: (id, body) => api.put(`${WRITE}/items/${id}`, body).then(data),
  deleteItem: (id) => api.del(`${WRITE}/items/${id}`).then(data),
};
