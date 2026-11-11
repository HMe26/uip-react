/** Helpers to bring files / whole folders into the archive (file picker, folder picker, drag & drop). */

export const MAX_UPLOAD_FILE = 50 * 1024 * 1024; // per file
export const MAX_UPLOAD_TOTAL = 200 * 1024 * 1024; // per drop / pick
export const MAX_IMPORT_FILES = 3000;

const NOISE = /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db|desktop\.ini)(\/|$)/i;

/** Normalises a relative path. Returns null for anything unsafe or junk. Keeps a trailing "/" for folders. */
export function cleanRel(raw) {
  const isDir = /[\\/]$/.test(String(raw || ''));
  const parts = String(raw || '').replace(/\\/g, '/').split('/').filter(Boolean);
  if (!parts.length || parts.some((p) => p === '.' || p === '..')) return null;
  const rel = parts.join('/');
  if (NOISE.test(rel)) return null;
  return isDir ? `${rel}/` : rel;
}

const readEntries = (reader) => new Promise((res, rej) => { reader.readEntries(res, rej); });
const entryFile = (entry) => new Promise((res, rej) => { entry.file(res, rej); });

async function walk(entry, prefix, out, ctx) {
  if (ctx.count >= MAX_IMPORT_FILES) { ctx.truncated = true; return; }
  if (entry.isFile) {
    ctx.count += 1;
    out.push({ rel: prefix + entry.name, file: await entryFile(entry) });
    return;
  }
  if (!entry.isDirectory) return;
  const here = `${prefix}${entry.name}/`;
  out.push({ rel: here, dir: true });
  const reader = entry.createReader();
  let batch = await readEntries(reader);
  while (batch.length) {
    // eslint-disable-next-line no-await-in-loop
    for (const child of batch) await walk(child, here, out, ctx);
    // eslint-disable-next-line no-await-in-loop
    batch = await readEntries(reader);
  }
}

/** DataTransfer -> { items:[{rel,file|dir}], truncated }. Call it synchronously from the drop handler. */
export async function readDataTransfer(dt) {
  const out = [];
  const ctx = { count: 0, truncated: false };
  const list = [...(dt.items || [])].filter((i) => i.kind === 'file');
  // entries must be grabbed before the first await — the browser empties the DataTransfer afterwards
  const entries = list.map((i) => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null));
  const files = [...(dt.files || [])];
  if (entries.length && entries.every(Boolean)) {
    for (const en of entries) {
      // eslint-disable-next-line no-await-in-loop
      await walk(en, '', out, ctx);
    }
  } else {
    files.forEach((f) => out.push({ rel: f.name, file: f }));
  }
  return { items: out, truncated: ctx.truncated };
}

/** <input type=file> FileList -> items. `keepFolders` uses webkitRelativePath (folder picker). */
export function itemsFromFileList(list, keepFolders) {
  const files = [...list];
  return {
    items: files.slice(0, MAX_IMPORT_FILES).map((f) => ({ rel: keepFolders ? (f.webkitRelativePath || f.name) : f.name, file: f })),
    truncated: files.length > MAX_IMPORT_FILES,
  };
}

/** "dir/name.ext" -> "dir/name (1).ext" (first free one according to `taken`). */
export function uniquePath(path, taken) {
  const slash = path.lastIndexOf('/');
  const dir = path.slice(0, slash + 1);
  const name = path.slice(slash + 1);
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let i = 1; i < 10000; i += 1) {
    const p = `${dir}${stem} (${i})${ext}`;
    if (!taken(p)) return p;
  }
  return `${dir}${stem}-${Date.now()}${ext}`;
}
