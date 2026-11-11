/**
 * detectApps — looks at the files of an open archive and lists what the "Run" button can start.
 *   kind 'web'    -> React/Vite or plain HTML/CSS/JS, runs in the browser (esbuild-wasm + esm.sh)
 *   kind 'python' -> Python script, runs in the browser (Pyodide)
 *   unsupported   -> recognised, but needs a real server (Laravel, Node/Express, Flask/Django …): shown disabled with a reason
 *   kind 'sandbox'-> the same server projects when the sandbox gateway is available (`sandbox: true`): they run in an
 *                    isolated container with a real terminal. `app.sandbox` is the gateway's kind (laravel | node | python).
 *
 * Any language / any project: besides the originals, the sandbox runs
 *   single files  (kind 'sandbox', sandbox 'lang', entry = the file): JavaScript, TypeScript, PHP, Java, C, C++, C#, F#, VB.NET, Go, Rust, Zig, Nim, D, Ada, COBOL, Assembly, Ruby, Perl, Raku, Lua, R, Julia, MATLAB/Octave, Bash, PowerShell, Kotlin, Scala, Groovy, Clojure, Dart, Haskell, OCaml, Elixir, Erlang, Lisp, Scheme, Racket, Prolog, Tcl, AWK, Fortran, Pascal, Verilog, VHDL, SQL, T-SQL
 *   whole projects (sandbox 'maven' | 'gradle' | 'dotnet' | 'go' | 'cargo' | 'rails' | 'php' | 'make'): Spring Boot / Maven / Gradle, ASP.NET, Go modules, Cargo, Rails, Symfony / WordPress / plain PHP, Makefile / CMake
 * A loose JavaScript file also gets an in-browser variant (the browser's own prompt() / alert() / console), so it runs without the sandbox.
 * Pure functions (no DOM, no React) so they are easy to test.
 */

/** extension -> language name, for the files the sandbox can run on their own */
export const LANGS = {
  js: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript', ts: 'TypeScript', mts: 'TypeScript', php: 'PHP', java: 'Java',
  c: 'C', cpp: 'C++', cc: 'C++', cxx: 'C++', cs: 'C#', go: 'Go', rs: 'Rust', rb: 'Ruby', pl: 'Perl', lua: 'Lua', r: 'R', jl: 'Julia',
  sh: 'Bash', bash: 'Bash', kt: 'Kotlin', kts: 'Kotlin', dart: 'Dart', hs: 'Haskell', f90: 'Fortran', f95: 'Fortran', f03: 'Fortran',
  pas: 'Pascal', pp: 'Pascal', sql: 'SQL', tsql: 'T-SQL',
  zig: 'Zig', nim: 'Nim', d: 'D', adb: 'Ada', cob: 'COBOL', cbl: 'COBOL', cobol: 'COBOL', asm: 'Assembly (NASM)', nasm: 'Assembly (NASM)', s: 'Assembly (GNU)',
  fs: 'F#', fsx: 'F#', vb: 'VB.NET', scala: 'Scala', groovy: 'Groovy', gvy: 'Groovy', clj: 'Clojure', cljc: 'Clojure',
  ex: 'Elixir', exs: 'Elixir', erl: 'Erlang', ml: 'OCaml', lisp: 'Common Lisp', lsp: 'Common Lisp', scm: 'Scheme', ss: 'Scheme', rkt: 'Racket',
  pro: 'Prolog', prolog: 'Prolog', tcl: 'Tcl', awk: 'AWK', raku: 'Raku', rakumod: 'Raku', p6: 'Raku', m: 'MATLAB / Octave', ps1: 'PowerShell',
  v: 'Verilog', sv: 'SystemVerilog', vhd: 'VHDL', vhdl: 'VHDL',
};
const JS_EXTS = ['js', 'mjs', 'cjs', 'ts', 'mts'];
const C_EXTS = ['c', 'cc', 'cpp', 'cxx', 'h', 'hpp'];
const ENTRY_LIKE = /^(main|index|app|program|hello|solution|run|test)\b/i;
const MAX_LOOSE = 10;

const IGNORE = /(^|\/)(node_modules|\.git|__pycache__|\.venv|venv|dist|build|\.next)\//;
const ENTRY_CANDIDATES = ['src/main.jsx', 'src/main.tsx', 'src/main.js', 'src/main.ts', 'src/index.jsx', 'src/index.tsx', 'src/index.js', 'src/index.ts', 'main.jsx', 'main.tsx', 'index.jsx', 'index.tsx', 'index.js'];
const PY_ENTRIES = ['main.py', 'app.py', 'run.py', '__main__.py', 'index.py', 'manage.py'];
const SERVER_PY = /^\s*(?:from|import)\s+(flask|django|fastapi|uvicorn|tornado|sanic|aiohttp)\b/im;
const MAX_DEPTH = 3;

const baseOf = (p) => p.slice(p.lastIndexOf('/') + 1);
const dirOf = (p) => { const i = p.lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i + 1); }; // '' or 'a/b/'
const depthOf = (dir) => (dir ? dir.split('/').length - 1 : 0);
const label = (what, dir) => (dir ? `${what} — ${dir.replace(/\/$/, '')}` : what);
const extOf = (p) => { const b = baseOf(p); const i = b.lastIndexOf('.'); return i < 0 ? '' : b.slice(i + 1).toLowerCase(); };

/** where a single file should run from: its own folder — except Java with a `package`, which runs from the source root above the package folders */
function runRoot(path, readText) {
  const dir = dirOf(path);
  if (extOf(path) === 'java') {
    const m = /^\s*package\s+([\w.]+)\s*;/m.exec(readText(path) || '');
    if (m) {
      const n = m[1].split('.').length;
      const parts = dir.split('/').filter(Boolean);
      if (parts.length >= n && parts.slice(-n).join('.') === m[1]) {
        const root = parts.slice(0, parts.length - n).join('/');
        return { root: root ? `${root}/` : '', entry: path.slice(root ? root.length + 1 : 0) };
      }
    }
  }
  return { root: dir, entry: path.slice(dir.length) };
}
/** does this JS look like it was written for Node (require / process / fs) rather than for the browser console? */
const looksNode = (src) => /\brequire\s*\(|\bprocess\.(argv|stdin|env|exit)|\bfrom\s+['"]node:|\bimport\s+.*\bfrom\s+['"](fs|path|os|readline|http|child_process)['"]/.test(src);

/**
 * @param {string[]} allPaths  file paths in the archive (no folders)
 * @param {{ activePath?: string|null, readText?: (path:string)=>string|null }} [opts]
 * @returns {Array<{id:string, kind:'web'|'python'|'unsupported', label:string, root:string, entry?:string, reason?:string}>}
 */
export function detectApps(allPaths, { activePath = null, readText = () => null, sandbox = false } = {}) {
  const paths = allPaths.filter((p) => !p.endsWith('/') && !IGNORE.test(p));
  const set = new Set(paths);
  const dirsWith = (name) => paths.filter((p) => baseOf(p) === name && depthOf(dirOf(p)) <= MAX_DEPTH).map(dirOf);
  const has = (dir, rel) => set.has(dir + rel);
  const json = (p) => { try { return JSON.parse(readText(p) || '{}'); } catch { return {}; } };
  const apps = [];
  // server projects: runnable on the sandbox gateway, otherwise listed as "needs a server"
  const server = (id, root, lbl, reason, kind, entry) => (sandbox
    ? { id, kind: 'sandbox', sandbox: kind, root, label: lbl, ...(entry ? { entry } : {}) }
    : { id, kind: 'unsupported', root, label: lbl, reason });
  const sandboxExtras = []; // optional sandbox variants of projects that also run in the browser (listed after everything else)
  const claimed = []; // dirs already explained as a Laravel / web / node project (python scan skips them)
  const owners = []; // { dir, exts } — a whole project owns the source files of its language (they are not offered as loose single files)
  const own = (dir, exts) => owners.push({ dir, exts });
  const owned = (p) => owners.some((o) => p.startsWith(o.dir) && o.exts.includes(extOf(p)));
  const pkgDirs = dirsWith('package.json');

  // ---- Laravel / PHP ---------------------------------------------------------------------------
  const phpRoots = [...new Set([...dirsWith('artisan'), ...dirsWith('composer.json')])];
  phpRoots.forEach((dir) => {
    const composer = has(dir, 'composer.json') ? json(`${dir}composer.json`) : {};
    const isLaravel = has(dir, 'artisan') || /laravel\/framework/.test(JSON.stringify(composer.require || {}));
    claimed.push(dir); own(dir, ['php']);
    apps.push(server(`php:${dir}`, dir, label(isLaravel ? 'Laravel' : 'PHP (Composer)', dir), 'php-server', isLaravel ? 'laravel' : 'php'));
  });

  // ---- package.json projects (React / Vite / Node) -----------------------------------------------
  dirsWith('package.json').forEach((dir) => {
    if (phpRoots.includes(dir)) return;
    const pkg = json(`${dir}package.json`);
    const deps = { ...pkg.devDependencies, ...pkg.dependencies };
    const hasHtml = has(dir, 'index.html') || has(dir, 'public/index.html');
    const entry = ENTRY_CANDIDATES.find((e) => has(dir, e));
    const react = !!(deps.react || deps['react-dom']);
    const serverSide = ['express', 'koa', 'fastify', '@nestjs/core', 'next', 'nuxt', 'hapi', '@hapi/hapi'].find((d) => deps[d]);
    if (hasHtml || (react && entry)) {
      claimed.push(dir); own(dir, JS_EXTS);
      const vite = !!deps.vite;
      apps.push({ id: `web:${dir}`, kind: 'web', root: dir, label: label(react ? (vite ? 'React (Vite)' : 'React') : 'Web', dir) });
      // the full dev server (real npm install, any package, proxy/API) as an alternative to the in-browser bundler
      if (sandbox && has(dir, 'package.json')) sandboxExtras.push({ id: `sbx-web:${dir}`, kind: 'sandbox', sandbox: 'node', root: dir, label: label(`${react ? (vite ? 'React (Vite)' : 'React') : 'Web'} — dev server (sandbox)`, dir) });
    } else if (serverSide) {
      claimed.push(dir);
      apps.push(server(`node:${dir}`, dir, label(`Node (${serverSide})`, dir), 'node-server', 'node'));
    }
  });

  // ---- plain static sites (index.html, no package.json) ------------------------------------------
  dirsWith('index.html').forEach((dir) => {
    if (claimed.includes(dir) || has(dir, 'package.json')) return;
    if (claimed.some((c) => dir.startsWith(`${c}public/`))) return; // e.g. laravel/public/index.html — that is the framework's docroot, not a site
    claimed.push(dir);
    apps.push({ id: `web:${dir}`, kind: 'web', root: dir, label: label('Web (HTML)', dir) });
  });

  // ---- loose HTML pages (no index.html, e.g. decrypt.html + decrypt.css + decrypt.js) ---------------
  // Every .html file that is not part of an already-recognised project is runnable on its own: the runner is handed that page
  // as the document (see collectRunFiles), and its sibling .css/.js files are resolved relative to it as usual.
  const isHtml = (p) => /\.html?$/i.test(p);
  const inClaimed = (p) => claimed.some((c) => c && p.startsWith(c));
  const looseByDir = new Map();
  paths.filter((p) => isHtml(p) && !inClaimed(p) && depthOf(dirOf(p)) <= MAX_DEPTH).forEach((p) => {
    const d = dirOf(p);
    if (has(d, 'index.html') || has(d, 'package.json')) return; // handled above
    if (!looseByDir.has(d)) looseByDir.set(d, []);
    looseByDir.get(d).push(baseOf(p));
  });
  looseByDir.forEach((names, dir) => names.sort().slice(0, 8).forEach((entry) => {
    apps.push({ id: `html:${dir}${entry}`, kind: 'web', root: dir, entry, label: label(`Web — ${entry}`, dir) });
  }));

  // ---- Java (Maven / Gradle), .NET, Go, Rust, Ruby, Makefile / CMake, plain PHP ------------------
  // Each one is a whole project: the sandbox builds and starts it with its own tool. Without the sandbox they are listed as "needs a server".
  const txt = (p) => readText(p) || '';
  [...new Set(dirsWith('pom.xml'))].forEach((dir) => {
    claimed.push(dir); own(dir, ['java', 'kt', 'kts']);
    apps.push(server(`mvn:${dir}`, dir, label(/spring-boot/.test(txt(`${dir}pom.xml`)) ? 'Spring Boot (Maven)' : 'Java (Maven)', dir), 'lang-server', 'maven'));
  });
  [...new Set([...dirsWith('build.gradle'), ...dirsWith('build.gradle.kts')])].forEach((dir) => {
    if (has(dir, 'pom.xml')) return;
    const gf = has(dir, 'build.gradle') ? `${dir}build.gradle` : `${dir}build.gradle.kts`;
    claimed.push(dir); own(dir, ['java', 'kt', 'kts']);
    apps.push(server(`gradle:${dir}`, dir, label(/org\.springframework\.boot/.test(txt(gf)) ? 'Spring Boot (Gradle)' : 'Java / Kotlin (Gradle)', dir), 'lang-server', 'gradle'));
  });
  const slnDirs = paths.filter((p) => /\.sln$/i.test(p) && depthOf(dirOf(p)) <= MAX_DEPTH).map(dirOf);
  const csprojs = paths.filter((p) => /\.csproj$/i.test(p) && depthOf(dirOf(p)) <= MAX_DEPTH);
  [...new Set([...slnDirs, ...csprojs.map(dirOf).filter((d) => !slnDirs.some((s) => d.startsWith(s)))])].forEach((dir) => {
    const web = csprojs.some((c) => c.startsWith(dir) && /Sdk="Microsoft\.NET\.Sdk\.Web"/.test(txt(c)));
    claimed.push(dir); own(dir, ['cs']);
    apps.push(server(`dotnet:${dir}`, dir, label(web ? 'ASP.NET Core' : '.NET', dir), 'lang-server', 'dotnet'));
  });
  [...new Set(dirsWith('go.mod'))].forEach((dir) => { claimed.push(dir); own(dir, ['go']); apps.push(server(`go:${dir}`, dir, label('Go (module)', dir), 'lang-server', 'go')); });
  [...new Set(dirsWith('Cargo.toml'))].forEach((dir) => { claimed.push(dir); own(dir, ['rs']); apps.push(server(`cargo:${dir}`, dir, label('Rust (Cargo)', dir), 'lang-server', 'cargo')); });
  [...new Set(dirsWith('Gemfile'))].forEach((dir) => {
    claimed.push(dir); own(dir, ['rb']);
    apps.push(server(`rails:${dir}`, dir, label(has(dir, 'config/application.rb') ? 'Ruby on Rails' : 'Ruby (Bundler)', dir), 'lang-server', 'rails'));
  });
  [...new Set([...dirsWith('CMakeLists.txt'), ...dirsWith('Makefile'), ...dirsWith('makefile')])].forEach((dir) => {
    if (claimed.includes(dir) && dir) return; // a Makefile that only wraps another project
    claimed.push(dir); own(dir, C_EXTS);
    apps.push(server(`make:${dir}`, dir, label(has(dir, 'CMakeLists.txt') ? 'C / C++ (CMake)' : 'C / C++ (make)', dir), 'lang-server', 'make'));
  });
  dirsWith('index.php').forEach((dir) => { // plain PHP site: no artisan / composer.json
    if (owners.some((o) => dir.startsWith(o.dir) && o.exts.includes('php') && (o.dir || phpRoots.includes(''))) || has(dir, 'composer.json')) return;
    claimed.push(dir); own(dir, ['php']);
    apps.push(server(`phpsite:${dir}`, dir, label('PHP site', dir), 'lang-server', 'php'));
  });

  // ---- Python ----------------------------------------------------------------------------------
  const pyFiles = paths.filter((p) => p.endsWith('.py'));
  const insideClaimed = (p) => claimed.some((c) => c && p.startsWith(c));
  const pyRoots = [...new Set(pyFiles.filter((p) => PY_ENTRIES.includes(baseOf(p)) && depthOf(dirOf(p)) <= MAX_DEPTH && !insideClaimed(p)).map(dirOf))];
  pyRoots.sort((a, b) => depthOf(a) - depthOf(b));
  pyRoots.forEach((dir) => {
    const entry = PY_ENTRIES.find((e) => has(dir, e));
    const src = readText(`${dir}${entry}`) || '';
    const srv = SERVER_PY.exec(src);
    if (srv) { apps.push(server(`pysrv:${dir}`, dir, label(`Python (${srv[1]})`, dir), 'py-server', 'python', entry)); return; }
    apps.push({ id: `py:${dir}:${entry}`, kind: 'python', root: dir, entry, label: label(`Python — ${entry}`, dir) });
    // a real terminal: input() waits for the user, so menus and login loops behave like on a normal computer
    if (sandbox) sandboxExtras.push({ id: `sbx-py:${dir}:${entry}`, kind: 'sandbox', sandbox: 'python', root: dir, entry, label: label(`Python — ${entry} (interactive terminal)`, dir) });
  });

  // ---- "run the HTML page I'm looking at" --------------------------------------------------------
  if (activePath && isHtml(activePath) && set.has(activePath) && !inClaimed(activePath)) {
    const hit = apps.find((a) => a.id === `html:${activePath}`);
    if (hit) { apps.splice(apps.indexOf(hit), 1); apps.unshift({ ...hit, current: true }); }
  }

  // ---- "run the file I'm looking at" -------------------------------------------------------------
  if (activePath && activePath.endsWith('.py') && set.has(activePath) && !IGNORE.test(activePath)) {
    // root = the python project folder this file belongs to (nearest ancestor that is a python root), else its own folder
    const owner = pyRoots.filter((d) => activePath.startsWith(d)).sort((a, b) => b.length - a.length)[0];
    const root = owner ?? dirOf(activePath);
    const entry = activePath.slice(root.length);
    if (!SERVER_PY.test(readText(activePath) || '')) {
      const already = apps.find((a) => a.kind === 'python' && a.root === root && a.entry === entry);
      if (!already) apps.unshift({ id: `pyfile:${activePath}`, kind: 'python', root, entry, label: `Python — ${baseOf(activePath)}`, current: true });
      else apps.unshift(apps.splice(apps.indexOf(already), 1)[0]);
      if (sandbox && !sandboxExtras.some((a) => a.sandbox === 'python' && a.root === root && a.entry === entry)) {
        sandboxExtras.unshift({ id: `sbx-pyfile:${activePath}`, kind: 'sandbox', sandbox: 'python', root, entry, label: label(`Python — ${baseOf(activePath)} (interactive terminal)`, root) });
      }
    }
  }
  // ---- single files in any other language (the file you are looking at first, then the usual entry files) ----------
  // a JavaScript/TypeScript file next to an .html page belongs to that page. Any other language (C#, Java, C++, Go …) is its own program:
  // an .html report that merely sits in the same folder must not hide it (it used to, so a main.cs could never be picked)
  const hasHtmlNext = (p) => JS_EXTS.includes(extOf(p)) && paths.some((q) => isHtml(q) && dirOf(q) === dirOf(p));
  const langApp = (p, current) => {
    const ext = extOf(p); const name = LANGS[ext];
    const { root, entry } = runRoot(p, readText);
    const lbl = label(`${name} — ${baseOf(p)}`, root);
    const out = [];
    const jsLike = ext === 'js' || ext === 'mjs' || ext === 'cjs';
    const node = jsLike && looksNode(readText(p) || '');
    // JavaScript can also run in the browser tab (its prompt() / alert() / console) — no server needed
    const browser = jsLike && !node ? { id: `jsb:${p}`, kind: 'web', root, entry, jsEntry: true, label: label(`${name} — ${baseOf(p)} (browser)`, root), ...(current ? { current } : {}) } : null;
    const box = sandbox
      ? { id: `lang:${p}`, kind: 'sandbox', sandbox: 'lang', root, entry, label: lbl, ...(current ? { current } : {}) }
      : { id: `lang:${p}`, kind: 'unsupported', root, entry, label: lbl, reason: 'lang-server', ...(current ? { current } : {}) };
    if (browser) out.push(browser);
    if (box.kind === 'sandbox' || !browser) out.push(box);
    return out;
  };
  const taken = new Set(apps.map((a) => a.id));
  const looseLang = [];
  const active = activePath && set.has(activePath) && LANGS[extOf(activePath)] ? activePath : null;
  if (active && !owned(active) && !isHtml(active) && !hasHtmlNext(active)) langApp(active, true).forEach((a) => { if (!taken.has(a.id)) { taken.add(a.id); looseLang.push(a); } });
  const candidates = paths.filter((p) => LANGS[extOf(p)] && extOf(p) !== 'py' && p !== active && depthOf(dirOf(p)) <= MAX_DEPTH
    && !owned(p) && !hasHtmlNext(p) && !(JS_EXTS.includes(extOf(p)) && pkgDirs.some((d) => p.startsWith(d))));
  candidates.sort((a, b) => (ENTRY_LIKE.test(baseOf(b)) - ENTRY_LIKE.test(baseOf(a))) || (depthOf(dirOf(a)) - depthOf(dirOf(b))) || a.localeCompare(b));
  candidates.slice(0, Math.max(0, MAX_LOOSE - looseLang.length)).forEach((p) => langApp(p, false).forEach((a) => { if (!taken.has(a.id)) { taken.add(a.id); looseLang.push(a); } }));

  // the sandbox variants come last, except for the file being looked at: that one leads
  const lead = looseLang.filter((a) => a.current);
  return [...lead, ...apps, ...looseLang.filter((a) => !a.current), ...sandboxExtras].sort((x, y) => (y.current === true) - (x.current === true));
}

export const defaultApp = (apps) => apps.find((a) => a.kind !== 'unsupported') || null;
