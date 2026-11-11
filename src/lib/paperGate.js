// Tiny counter the paper reveal waits on: while a lazy route chunk is loading (PageLoading is mounted)
// the paper stays closed, then it opens on the finished page.
let n = 0;
const subs = new Set();
export const holdPaper = () => {
  n += 1;
  return () => { n = Math.max(0, n - 1); subs.forEach((f) => f()); };
};
export const paperPending = () => n;
export const subscribePaper = (f) => { subs.add(f); return () => subs.delete(f); };
