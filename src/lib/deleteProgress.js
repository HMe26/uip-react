import { useSyncExternalStore } from 'react';

/**
 * Delete progress — a small, non-blocking indicator for deletions in My PC (move to recycle bin, delete forever, empty the bin).
 * drive.trash / purge / emptyTrash register their request here (lib/driveApi.js); <DeleteProgressHost/> draws a ring with a live
 * seconds counter until the server answers. The student can close the card at any time — the deletion carries on either way.
 */
let jobs = []; // { id, kind: 'trash' | 'purge' | 'empty', count, started, state: 'run' | 'ok' | 'err', hidden }
let snap = jobs;
let seq = 0;
const subs = new Set();
const emit = () => { snap = [...jobs]; subs.forEach((f) => f()); };

function patch(id, p) { jobs = jobs.map((j) => (j.id === id ? { ...j, ...p } : j)); emit(); }
function drop(id) { jobs = jobs.filter((j) => j.id !== id); emit(); }

/** Registers `promise` as a deletion job and returns it unchanged (errors still reach the caller). */
export function trackDelete(kind, count, promise) {
  seq += 1;
  const id = `d${seq}`;
  jobs = [...jobs, { id, kind, count: Number(count) || 0, started: Date.now(), state: 'run', hidden: false }];
  emit();
  promise.then(
    () => { patch(id, { state: 'ok' }); setTimeout(() => drop(id), 1800); },
    () => { patch(id, { state: 'err' }); setTimeout(() => drop(id), 5000); },
  );
  return promise;
}

export const deleteJobs = {
  hide: (id) => patch(id, { hidden: true }), // closes the card only — the deletion itself is not cancelled
};

export function useDeleteJobs() {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => snap, () => snap);
}
