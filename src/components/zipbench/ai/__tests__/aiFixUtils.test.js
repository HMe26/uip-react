import test from 'node:test';
import assert from 'node:assert/strict';
import { stripAnsi, tailOutput, looksLikeError, extractRefs, guessErrorFile, applyEdit, applyEdits, diffRows, languageOf, suggestFileName } from '../aiFixUtils.js';

test('stripAnsi removes colours and normalises line endings', () => {
  assert.equal(stripAnsi('\x1b[31mError\x1b[0m: x\r\ny\rz'), 'Error: x\ny\nz');
});

test('tailOutput keeps the end and cuts at a line start', () => {
  const t = Array.from({ length: 500 }, (_, i) => `line ${i}`).join('\n');
  const out = tailOutput(t, 100);
  assert.ok(out.length <= 100);
  assert.ok(out.endsWith('line 499'));
  assert.match(out.split('\n')[0], /^line \d+$/);
});

test('looksLikeError', () => {
  assert.equal(looksLikeError('Server started on 3000'), false);
  assert.equal(looksLikeError('TypeError: x is not a function'), true);
});

test('python traceback -> last frame that is a project file', () => {
  const out = 'Traceback (most recent call last):\n  File "/app/main.py", line 10, in <module>\n    run()\n  File "/app/utils/calc.py", line 4, in run\n    return 1/0\nZeroDivisionError: division by zero';
  assert.deepEqual(guessErrorFile(out, ['proj/main.py', 'proj/utils/calc.py'], 'proj/main.py'), { path: 'proj/utils/calc.py', line: 4 });
});

test('python: stdlib / site-packages frames are ignored', () => {
  const out = 'Traceback (most recent call last):\n  File "main.py", line 3, in <module>\n    import requests\n  File "/usr/lib/python3.11/site-packages/requests/__init__.py", line 9\nModuleNotFoundError: x';
  assert.deepEqual(guessErrorFile(out, ['main.py'], 'main.py'), { path: 'main.py', line: 3 });
});

test('node stack -> first project frame, node_modules skipped', () => {
  const out = 'ReferenceError: foo is not defined\n    at render (/app/src/App.jsx:12:5)\n    at /app/node_modules/react/index.js:44:1';
  assert.deepEqual(guessErrorFile(out, ['ui/src/App.jsx', 'ui/src/main.jsx'], ''), { path: 'ui/src/App.jsx', line: 12 });
});

test('php fatal error', () => {
  const out = 'PHP Fatal error:  Uncaught Error: Call to undefined function foo() in /var/www/html/app/Http/X.php:31';
  assert.deepEqual(guessErrorFile(out, ['api/app/Http/X.php', 'api/app/Models/X.php'], ''), { path: 'api/app/Http/X.php', line: 31 });
  const out2 = 'Parse error: syntax error, unexpected token in app/Http/X.php on line 7';
  assert.deepEqual(guessErrorFile(out2, ['api/app/Http/X.php'], ''), { path: 'api/app/Http/X.php', line: 7 });
});

test('same file name in two folders: the longer matching path wins', () => {
  const out = 'Error at src/utils/index.js:3:1';
  assert.deepEqual(guessErrorFile(out, ['p/index.js', 'p/src/utils/index.js'], ''), { path: 'p/src/utils/index.js', line: 3 });
});

test('no reference to a project file -> null', () => {
  assert.equal(guessErrorFile('npm ERR! missing script: start', ['package.json'], ''), null);
  assert.deepEqual(extractRefs('nothing here'), []);
});

test('applyEdit: exact, missing, ambiguous, CRLF kept', () => {
  assert.deepEqual(applyEdit('a\nb\nc', { search: 'b', replace: 'B' }), { ok: true, text: 'a\nB\nc' });
  assert.deepEqual(applyEdit('a\nb', { search: 'x', replace: 'y' }), { ok: false, reason: 'missing' });
  assert.deepEqual(applyEdit('a\na', { search: 'a', replace: 'y' }), { ok: false, reason: 'ambiguous' });
  assert.deepEqual(applyEdit('a\r\nb\r\nc', { search: 'b', replace: 'B\nB2' }), { ok: true, text: 'a\r\nB\r\nB2\r\nc' });
  assert.equal(applyEdit('x', { search: 'x', replace: '$& $1' }).text, '$& $1');
});

test('applyEdits reports which ones failed', () => {
  const r = applyEdits('one\ntwo\nthree', [{ search: 'one', replace: '1' }, { search: 'nope', replace: 'x' }, { search: 'three', replace: '3' }]);
  assert.equal(r.text, '1\ntwo\n3');
  assert.deepEqual(r.applied, [0, 2]);
  assert.deepEqual(r.failed, [1]);
});

test('diffRows trims unchanged lines and numbers them', () => {
  const rows = diffRows({ search: 'a\nb\nc\nd', replace: 'a\nB\nc\nd', start_line: 10 });
  assert.deepEqual(rows.map((r) => r.t + r.s), [' a', '-b', '+B', ' c', ' d']);
  assert.equal(rows[1].n, 11);
});

test('languageOf', () => {
  assert.equal(languageOf('a/b/x.py'), 'Python');
  assert.equal(languageOf('resources/views/a.blade.php'), 'Blade (Laravel)');
  assert.equal(languageOf('Makefile'), '');
});

test('suggestFileName: converted file and test file names', () => {
  assert.equal(suggestFileName('convert', 'src/app/calc.py', 'C++'), 'src/app/calc.cpp');
  assert.equal(suggestFileName('convert', 'calc.py', 'Weird'), 'calc.txt');
  assert.equal(suggestFileName('test', 'src/calc.py'), 'src/test_calc.py');
  assert.equal(suggestFileName('test', 'src/calc.jsx'), 'src/calc.test.jsx');
  assert.equal(suggestFileName('test', 'app/cart.php'), 'app/CartTest.php');
  assert.equal(suggestFileName('test', 'Main.java'), 'MainTest.java');
  assert.equal(suggestFileName('test', 'main.go'), 'main_test.go');
});
