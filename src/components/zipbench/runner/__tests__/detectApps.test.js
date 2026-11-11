import test from 'node:test';
import assert from 'node:assert/strict';
import { detectApps, defaultApp } from '../detectApps.js';

const read = (map) => (p) => map[p] ?? null;

test('mono-repo: Laravel backend + React frontend + a python script', () => {
  const paths = ['proj/backend/artisan', 'proj/backend/composer.json', 'proj/backend/public/index.php', 'proj/backend/package.json',
    'proj/frontend/package.json', 'proj/frontend/index.html', 'proj/frontend/src/main.jsx', 'proj/frontend/node_modules/react/index.js',
    'proj/scripts/main.py', 'proj/README.md'];
  const apps = detectApps(paths, { readText: read({ 'proj/frontend/package.json': '{"dependencies":{"react":"^19","vite":"^7"}}', 'proj/backend/composer.json': '{"require":{"laravel/framework":"^11"}}', 'proj/scripts/main.py': 'print(1)' }) });
  const by = Object.fromEntries(apps.map((a) => [a.id, a]));
  assert.equal(by['web:proj/frontend/'].kind, 'web');
  assert.match(by['web:proj/frontend/'].label, /React \(Vite\)/);
  assert.equal(by['php:proj/backend/'].kind, 'unsupported');
  assert.equal(by['php:proj/backend/'].reason, 'php-server');
  assert.equal(by['py:proj/scripts/:main.py'].entry, 'main.py');
  assert.equal(defaultApp(apps).kind !== 'unsupported', true);
  assert.equal(apps.some((a) => a.id.includes('node_modules')), false);
});

test('laravel public/index.html is not mistaken for a static site', () => {
  const apps = detectApps(['artisan', 'composer.json', 'public/index.html'], { readText: read({}) });
  assert.deepEqual(apps.map((a) => a.kind), ['unsupported']);
});

test('plain static site and react without index.html', () => {
  assert.equal(detectApps(['site/index.html', 'site/style.css'])[0].label, 'Web (HTML) — site');
  const a = detectApps(['package.json', 'src/index.js'], { readText: read({ 'package.json': '{"dependencies":{"react":"18"}}' }) });
  assert.equal(a[0].kind, 'web');
});

test('python: active file runs first, flask is flagged as needing a server', () => {
  const paths = ['app/main.py', 'app/utils/helper.py', 'tools/run.py'];
  const apps = detectApps(paths, { activePath: 'app/utils/helper.py', readText: read({ 'app/main.py': 'print(1)', 'tools/run.py': 'from flask import Flask\napp = Flask(__name__)' }) });
  assert.equal(apps[0].current, true);
  assert.equal(apps[0].root, 'app/'); assert.equal(apps[0].entry, 'utils/helper.py');
  assert.ok(apps.find((a) => a.id === 'pysrv:tools/'));
  assert.ok(apps.find((a) => a.kind === 'python' && a.entry === 'main.py'));
});

test('active file that is already the default entry is moved first without duplicating', () => {
  const apps = detectApps(['main.py', 'other.py'], { activePath: 'main.py', readText: read({ 'main.py': 'x=1' }) });
  assert.equal(apps.filter((a) => a.kind === 'python').length, 1);
});

test('nothing runnable', () => { assert.equal(defaultApp(detectApps(['README.md', 'a.txt'])), null); });

test('sandbox mode: server projects become runnable on the gateway, browser-runnable ones get an extra variant', () => {
  const paths = ['be/artisan', 'be/composer.json', 'fe/package.json', 'fe/index.html', 'fe/src/main.jsx', 'api/server.js', 'api/package.json', 'tools/main.py', 'dj/manage.py', 'fl/app.py'];
  const apps = detectApps(paths, { sandbox: true, readText: read({
    'fe/package.json': '{"dependencies":{"react":"19","vite":"7"}}', 'api/package.json': '{"dependencies":{"express":"4"}}',
    'be/composer.json': '{"require":{"laravel/framework":"11"}}', 'tools/main.py': 'print(1)',
    'dj/manage.py': 'from django.core.management import execute_from_command_line', 'fl/app.py': 'from flask import Flask',
  }) });
  const by = Object.fromEntries(apps.map((a) => [a.id, a]));
  assert.deepEqual([by['php:be/'].kind, by['php:be/'].sandbox], ['sandbox', 'laravel']);
  assert.deepEqual([by['node:api/'].kind, by['node:api/'].sandbox], ['sandbox', 'node']);
  assert.deepEqual([by['pysrv:dj/'].kind, by['pysrv:dj/'].sandbox, by['pysrv:dj/'].entry], ['sandbox', 'python', 'manage.py']);
  assert.deepEqual([by['pysrv:fl/'].kind, by['pysrv:fl/'].entry], ['sandbox', 'app.py']);
  assert.equal(by['web:fe/'].kind, 'web');                       // quick in-browser run stays available…
  assert.equal(by['sbx-web:fe/'].sandbox, 'node');                // …plus the full dev server
  assert.equal(by['py:tools/:main.py'].kind, 'python');
  assert.equal(by['sbx-py:tools/:main.py'].sandbox, 'python');    // interactive terminal variant
  assert.ok(apps.indexOf(by['sbx-web:fe/']) > apps.indexOf(by['web:fe/']));
  assert.equal(apps.some((a) => a.kind === 'unsupported'), false);
});

test('without the sandbox nothing changes: Django is flagged as needing a server', () => {
  const apps = detectApps(['dj/manage.py'], { readText: read({ 'dj/manage.py': 'from django.core.management import execute_from_command_line' }) });
  assert.deepEqual(apps.map((a) => a.kind), ['unsupported']);
});

test('loose HTML files without index.html are runnable; the open one is first', () => {
  const apps = detectApps(['decrypt.html', 'decrypt.css', 'decrypt.js', 'other.html'], { activePath: 'other.html' });
  assert.equal(apps.length, 2);
  assert.equal(apps[0].entry, 'other.html'); assert.equal(apps[0].current, true); assert.equal(apps[0].kind, 'web');
  assert.equal(defaultApp(apps).kind, 'web');
});
test('html inside a React project is not listed as a separate app', () => {
  const apps = detectApps(['package.json', 'index.html', 'src/main.jsx', 'docs/a.html'], { readText: () => '{"dependencies":{"react":"18"}}' });
  assert.equal(apps.filter((a) => a.entry === 'a.html').length, apps.filter((a) => a.root === 'docs/' ).length);
});

// ---- any language / any project ------------------------------------------------------------------------------
const JS_BROWSER = 'const name = prompt("Enter your name:");\nconsole.log("Hello, " + name);\nalert("hi");';

test('a lone JavaScript file (browser-style prompt/alert) runs in the browser AND in the sandbox; the browser one is the default', () => {
  const apps = detectApps(['mai.js', 'README.md'], { activePath: 'mai.js', sandbox: true, readText: read({ 'mai.js': JS_BROWSER }) });
  assert.deepEqual(apps.map((a) => [a.kind, a.sandbox, a.entry]), [['web', undefined, 'mai.js'], ['sandbox', 'lang', 'mai.js']]);
  assert.equal(apps[0].jsEntry, true);
  assert.equal(defaultApp(apps).kind, 'web');
});
test('a lone JavaScript file without the sandbox: browser run + a "needs the sandbox" note is not shown when the browser variant exists', () => {
  const apps = detectApps(['mai.js'], { activePath: 'mai.js', readText: read({ 'mai.js': JS_BROWSER }) });
  assert.deepEqual(apps.map((a) => a.kind), ['web']);
});
test('Node-style JavaScript (require / process) goes to the sandbox only', () => {
  const apps = detectApps(['a.js'], { activePath: 'a.js', sandbox: true, readText: read({ 'a.js': 'const fs = require("fs"); console.log(process.argv)' }) });
  assert.deepEqual(apps.map((a) => [a.kind, a.sandbox]), [['sandbox', 'lang']]);
  assert.equal(detectApps(['a.js'], { activePath: 'a.js', readText: read({ 'a.js': 'require("fs")' }) })[0].kind, 'unsupported');
});

test('single files: Java (package root), C, C++, Go, Rust, Ruby, Kotlin, C#, SQL, Bash…', () => {
  const files = ['ex/Main.java', 'c/main.c', 'cpp/main.cpp', 'go/main.go', 'rs/main.rs', 'rb/app.rb', 'kt/main.kt', 'cs/Program.cs', 'db/q.sql', 'sh/run.sh'];
  const apps = detectApps(files, { sandbox: true, readText: read({}) });
  for (const f of ['jl/a.jl', 'hs/a.hs', 'lua/a.lua', 'pl/a.pl', 'r/a.R', 'dart/a.dart', 'f/a.f90', 'p/a.pas']) {
    assert.equal(detectApps([f], { activePath: f, sandbox: true, readText: read({}) })[0].sandbox, 'lang', f);
  }
  assert.equal(apps.length, 10); // the dropdown is capped
  const by = Object.fromEntries(apps.map((a) => [a.entry, a]));
  for (const f of files) assert.equal(by[f.split('/')[1]].sandbox, 'lang', f);
  assert.equal(by['Main.java'].root, 'ex/');
  assert.match(by['Main.java'].label, /^Java — Main\.java/);
});
test('a lone .tsql file (T-SQL) is runnable on the sandbox', () => {
  const apps = detectApps(['main.tsql'], { activePath: 'main.tsql', sandbox: true, readText: read({ 'main.tsql': "PRINT 'hi';" }) });
  assert.deepEqual(apps.map((a) => [a.kind, a.sandbox, a.entry]), [['sandbox', 'lang', 'main.tsql']]);
  assert.match(apps[0].label, /^T-SQL — main\.tsql/);
});
test('Java with a package runs from the source root above the package folders', () => {
  const src = 'package com.uip.app;\npublic class Main { public static void main(String[] a){} }';
  const apps = detectApps(['src/com/uip/app/Main.java', 'src/com/uip/app/Util.java'], { activePath: 'src/com/uip/app/Main.java', sandbox: true, readText: read({ 'src/com/uip/app/Main.java': src }) });
  assert.deepEqual([apps[0].root, apps[0].entry], ['src/', 'com/uip/app/Main.java']);
});

test('whole projects: Maven / Spring, Gradle, .NET, Go, Cargo, Rails, plain PHP, Makefile', () => {
  const paths = ['mv/pom.xml', 'mv/src/main/java/App.java', 'gr/build.gradle', 'gr/src/main/java/App.java', 'dn/App.csproj', 'dn/Program.cs',
    'go/go.mod', 'go/main.go', 'rs/Cargo.toml', 'rs/src/main.rs', 'rb/Gemfile', 'rb/config/application.rb', 'rb/app.rb', 'ph/index.php', 'mk/Makefile', 'mk/main.c'];
  const apps = detectApps(paths, { sandbox: true, readText: read({
    'mv/pom.xml': '<parent><artifactId>spring-boot-starter-parent</artifactId></parent>',
    'gr/build.gradle': "plugins { id 'org.springframework.boot' version '3.3.0' }", 'dn/App.csproj': '<Project Sdk="Microsoft.NET.Sdk.Web"></Project>' }) });
  const by = Object.fromEntries(apps.map((a) => [a.id, a]));
  assert.deepEqual([by['mvn:mv/'].sandbox, by['mvn:mv/'].label], ['maven', 'Spring Boot (Maven) — mv']);
  assert.deepEqual([by['gradle:gr/'].sandbox, by['gradle:gr/'].label], ['gradle', 'Spring Boot (Gradle) — gr']);
  assert.deepEqual([by['dotnet:dn/'].sandbox, by['dotnet:dn/'].label], ['dotnet', 'ASP.NET Core — dn']);
  assert.equal(by['go:go/'].sandbox, 'go');
  assert.equal(by['cargo:rs/'].sandbox, 'cargo');
  assert.deepEqual([by['rails:rb/'].sandbox, by['rails:rb/'].label], ['rails', 'Ruby on Rails — rb']);
  assert.equal(by['phpsite:ph/'].sandbox, 'php');
  assert.deepEqual([by['make:mk/'].sandbox, by['make:mk/'].label], ['make', 'C / C++ (make) — mk']);
  // the source files of those projects are not offered a second time as loose files
  assert.equal(apps.some((a) => a.id.startsWith('lang:')), false);
});
test('without the sandbox those projects are listed as needing it', () => {
  const apps = detectApps(['pom.xml', 'src/main/java/App.java'], { readText: read({ 'pom.xml': '<project/>' }) });
  assert.deepEqual(apps.map((a) => [a.kind, a.reason]), [['unsupported', 'lang-server']]);
});

test('Composer projects that are not Laravel run as plain PHP, Laravel stays Laravel', () => {
  const a = detectApps(['s/composer.json', 's/public/index.php', 'l/artisan', 'l/composer.json'], { sandbox: true, readText: read({ 's/composer.json': '{"require":{"symfony/framework-bundle":"7"}}', 'l/composer.json': '{"require":{"laravel/framework":"11"}}' }) });
  const by = Object.fromEntries(a.map((x) => [x.id, x]));
  assert.equal(by['php:s/'].sandbox, 'php'); assert.equal(by['php:l/'].sandbox, 'laravel');
});

test('scripts next to an HTML page, and files of a React / Vite project, are not offered as loose files', () => {
  assert.equal(detectApps(['page.html', 'page.js'], { sandbox: true }).some((a) => a.id.startsWith('lang:') || a.id.startsWith('jsb:')), false);
  const react = detectApps(['package.json', 'index.html', 'src/main.jsx', 'src/util.js'], { activePath: 'src/util.js', sandbox: true, readText: () => '{"dependencies":{"react":"18"}}' });
  assert.equal(react.some((a) => a.id.startsWith('lang:') || a.id.startsWith('jsb:')), false);
});

test('the open file leads; an open Python file also gets an interactive-terminal variant', () => {
  const apps = detectApps(['x/a.py', 'y/main.go'], { activePath: 'y/main.go', sandbox: true, readText: read({ 'x/a.py': 'print(1)' }) });
  assert.equal(apps[0].entry, 'main.go');
  const py = detectApps(['t.py'], { activePath: 't.py', sandbox: true, readText: read({ 't.py': 'print(1)' }) });
  assert.deepEqual(py.map((a) => a.kind), ['python', 'sandbox']);
});

test('single files: the extra languages (Zig, Nim, D, Ada, COBOL, Assembly, F#, Scala, Elixir, OCaml, Lisp, Prolog, Verilog, VHDL, PowerShell…)', () => {
  const files = ['a.zig', 'a.nim', 'a.d', 'a.adb', 'a.cob', 'a.asm', 'a.s', 'a.fs', 'a.fsx', 'a.vb', 'a.scala', 'a.groovy', 'a.clj', 'a.exs', 'a.erl', 'a.ml', 'a.lisp', 'a.scm', 'a.rkt',
    'a.pro', 'a.tcl', 'a.awk', 'a.raku', 'a.m', 'a.ps1', 'a.v', 'a.sv', 'a.vhd'];
  for (const f of files) {
    const apps = detectApps([f], { activePath: f, sandbox: true, readText: read({}) });
    assert.deepEqual([apps[0].kind, apps[0].sandbox, apps[0].entry], ['sandbox', 'lang', f], f);
    assert.equal(detectApps([f], { activePath: f, readText: read({}) })[0].kind, 'unsupported', `${f} without the sandbox`);
  }
});

test('a C# file next to an .html report is still runnable, and leads when it is the open file', () => {
  const paths = ['report.html', 'main.cs'];
  const idle = detectApps(paths, { sandbox: true });
  assert.ok(idle.some((a) => a.id === 'lang:main.cs'), 'main.cs is offered');
  const open = detectApps(paths, { sandbox: true, activePath: 'main.cs' });
  assert.equal(open[0].id, 'lang:main.cs');
  assert.equal(defaultApp(open).id, 'lang:main.cs');
  // JS next to an .html page still belongs to that page
  assert.deepEqual(detectApps(['a.html', 'app.js'], { sandbox: true }).map((a) => a.id), ['html:a.html']);
});
