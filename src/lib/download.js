import { api } from '../api/client';

/** Fetch an authenticated file (Bearer) and save it with `name`. */
export async function downloadAuthed(path, name, params) {
  const res = await api.blob(path, params ? { ...params, download: 1 } : { download: 1 });
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name || 'file';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
