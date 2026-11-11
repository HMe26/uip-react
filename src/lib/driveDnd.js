import { unzipSync } from 'fflate';
import { fetchDownload, fetchDriveBlob } from './driveApi';

/**
 * Dragging My PC files between windows. Two kinds of drags meet here:
 *  - HTML5 drags (file explorer rows): the dragged items travel in the DataTransfer under IDS_MIME (ids) / NODES_MIME (id + name + type);
 *  - pointer drags (desktop icons, which are moved with pointer events): they call dropOnWindowAt(), which hands the nodes to the window
 *    under the pointer as a DROP_EVENT — any element marked `data-drive-drop` can listen for it.
 * markDropTarget() highlights (`data-drop-over`) the window that would receive a pointer drag.
 */
export const IDS_MIME = 'application/x-drive-ids';
export const NODES_MIME = 'application/x-drive-nodes';
export const DROP_EVENT = 'uip-drive-drop';

export const hasDriveIds = (dt) => !!dt && [...(dt.types || [])].includes(IDS_MIME);

/** Put the dragged nodes on a DataTransfer (dragstart). */
export function setDragData(dt, nodes) {
  dt.setData(IDS_MIME, JSON.stringify(nodes.map((n) => n.id)));
  try { dt.setData(NODES_MIME, JSON.stringify(nodes.map((n) => ({ id: n.id, name: n.name, type: n.type, parent_id: n.parent_id ?? null })))); } catch { /* ignore */ }
  dt.effectAllowed = 'copyMove'; // moved inside My PC, copied into a code project
}

/** [{ id, name?, type? }] from a drop's DataTransfer. */
export function readDragNodes(dt) {
  try {
    const nodes = JSON.parse(dt.getData(NODES_MIME) || 'null');
    if (Array.isArray(nodes) && nodes.length) return nodes.filter((n) => n && Number.isInteger(n.id));
  } catch { /* fall back to the ids */ }
  try {
    const ids = JSON.parse(dt.getData(IDS_MIME) || '[]');
    return Array.isArray(ids) ? ids.filter(Number.isInteger).map((id) => ({ id })) : [];
  } catch { return []; }
}
export const readDragIds = (dt) => readDragNodes(dt).map((n) => n.id);

let marked = null;
const dropElAt = (x, y) => document.elementFromPoint(x, y)?.closest?.('[data-drive-drop]') || null;
/** While a pointer drag is over a window that accepts drops, outline it. */
export function markDropTarget(x, y) {
  const el = dropElAt(x, y);
  if (el === marked) return el;
  if (marked) marked.removeAttribute('data-drop-over');
  if (el) el.setAttribute('data-drop-over', '1');
  marked = el;
  return el;
}
export function clearDropMark() { if (marked) { marked.removeAttribute('data-drop-over'); marked = null; } }

/** A pointer drag ended at (x, y): give the nodes to the window there. Returns true when a window took them. */
export function dropOnWindowAt(x, y, nodes) {
  clearDropMark();
  const under = document.elementFromPoint(x, y);
  const el = under?.closest?.('[data-drive-drop]');
  if (!el || !nodes?.length) return false;
  el.dispatchEvent(new CustomEvent(DROP_EVENT, { detail: { nodes, x, y, target: under } }));
  return true;
}

/** My PC files / folders -> [{ rel, file | dir }] ready for the code workbench's importItems (folders come through their ZIP). */
export async function nodesToImportItems(nodes) {
  const items = [];
  for (const n of nodes) {
    if (!n || !n.id) continue;
    if (n.type === 'folder') {
      const { blob } = await fetchDownload({ id: n.id, type: 'folder', name: n.name || 'folder' }); // eslint-disable-line no-await-in-loop
      const root = n.name || 'folder';
      items.push({ rel: `${root}/`, dir: true });
      const files = unzipSync(new Uint8Array(await blob.arrayBuffer())); // eslint-disable-line no-await-in-loop
      Object.keys(files).forEach((p) => {
        if (p.endsWith('/')) items.push({ rel: `${root}/${p}`, dir: true });
        else items.push({ rel: `${root}/${p}`, file: new File([files[p]], p.split('/').pop()) });
      });
    } else {
      const blob = await fetchDriveBlob(n.id); // eslint-disable-line no-await-in-loop
      const name = n.name || `file-${n.id}`;
      items.push({ rel: name, file: new File([blob], name, { type: blob.type || '' }) });
    }
  }
  return items;
}
