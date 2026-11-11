#!/usr/bin/env python3
"""
CSS !important audit.  Usage:
  python3 scripts/css-audit.py            # report only (writes nothing)
  python3 scripts/css-audit.py --fix      # also strips the PROVABLY redundant ones
  python3 scripts/css-audit.py --check N  # exit 1 if total !important > N   (CI guard: keeps the number from growing)

An `!important` is "redundant" when nothing else in the whole bundle can compete with it:
  * no other rule sets the same property on a selector sharing the same last class/id/tag token, AND
  * the property is never set inline from JSX (style={{...}}) or from a JS-injected <style>, AND
  * it is not inside @keyframes / @media print / prefers-reduced-motion / forced-colors (legit uses), AND
  * it is not a utility "hide/force" on display/visibility/pointer-events (those are intentional).
Removing such a flag cannot change the cascade result: there is no competing declaration for it to beat.
"""
import re, sys, glob, os, collections

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
CSS = sorted(glob.glob(os.path.join(ROOT, 'src/styles/**/*.css'), recursive=True))
CSS += [p for p in glob.glob(os.path.join(ROOT, 'src/**/*.css'), recursive=True) if p not in CSS]
JSX = glob.glob(os.path.join(ROOT, 'src/**/*.jsx'), recursive=True) + glob.glob(os.path.join(ROOT, 'src/**/*.js'), recursive=True)
KEEP_PROPS = {'display', 'visibility', 'pointer-events', 'content-visibility', 'user-select', '-webkit-user-select', 'animation', 'animation-duration', 'transition', 'transition-duration', 'scroll-behavior', 'caret-color'}
LEGIT_AT = re.compile(r'@keyframes|@media print|prefers-reduced-motion|forced-colors|prefers-contrast|@font-face|@page')

def strip_comments(s):
    return re.sub(r'/\*.*?\*/', lambda m: ' ' * len(m.group(0)) if False else re.sub(r'[^\n]', ' ', m.group(0)), s, flags=re.S)

def parse(text):
    """Yield (selector, prop, value_start, value_end, important, ctx, decl_span) for every declaration, with at-rule context."""
    text_nc = strip_comments(text)
    out = []
    stack = []   # (kind, header)
    i = 0; n = len(text_nc); buf_start = 0
    while i < n:
        c = text_nc[i]
        if c == '{':
            header = text_nc[buf_start:i].strip()
            stack.append(header)
            buf_start = i + 1
        elif c == '}':
            # declarations pending before this '}'
            body = text_nc[buf_start:i]
            if stack and not stack[-1].startswith('@') or (stack and stack[-1].startswith('@font-face')):
                sel = stack[-1]
                ctx = ' '.join(h for h in stack[:-1] if h.startswith('@'))
                pos = buf_start
                for d in re.finditer(r'([-\w]+)\s*:\s*([^;{}]+?)\s*(;|$)', body):
                    prop = d.group(1); val = d.group(2)
                    imp = bool(re.search(r'!\s*important\s*$', val))
                    out.append((sel, prop, pos + d.start(2), pos + d.end(2), imp, ctx))
            if stack: stack.pop()
            buf_start = i + 1
        elif c == ';' and stack and stack[-1].startswith('@') and not stack[-1].startswith(('@media', '@supports', '@keyframes', '@layer', '@font-face', '@container')):
            buf_start = i + 1
        i += 1
    return out

def last_tokens(sel):
    toks = set()
    for part in sel.split(','):
        part = part.strip()
        if not part: continue
        last = re.split(r'[\s>+~]+', part)[-1]
        for t in re.findall(r'[.#][\w-]+|^[a-z][\w-]*', last):
            toks.add(t)
    return toks

def main():
    fix = '--fix' in sys.argv
    check = None
    if '--check' in sys.argv:
        check = int(sys.argv[sys.argv.index('--check') + 1])
    inline_pairs = set()     # (class token, css prop) set inline on the SAME JSX element
    js_props = set()         # props assigned from JS (el.style.x = …, setProperty) — can't be tied to a class
    camel = lambda p: re.sub(r'([A-Z])', lambda x: '-' + x.group(1).lower(), p)
    for f in JSX:
        s_ = open(f, encoding='utf8', errors='ignore').read()
        for m in re.finditer(r'<[A-Za-z][^<>]*?(?:\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}[^<>]*?)*>', s_, flags=re.S):
            tag = m.group(0)
            sm = re.search(r'style=\{\{(.*?)\}\}', tag, flags=re.S)
            if not sm: continue
            props = {camel(p) for p in re.findall(r'([A-Za-z]+)\s*:', sm.group(1))}
            classes = set(re.findall(r'className=(?:"([^"]*)"|\{`([^`]*)`\}|\{\'([^\']*)\'\})', tag))
            toks = set()
            for grp in classes:
                for part in grp:
                    for c in re.findall(r'[A-Za-z_][\w-]*', part or ''): toks.add('.' + c)
            if not toks:   # className built dynamically: assume it could be anything on this tag
                toks = {'*'}
            for t in toks:
                for p in props: inline_pairs.add((t, p))
        for m in re.finditer(r'\.style\.([A-Za-z]+)\s*=|style\.setProperty\(\s*[\'"]([-\w]+)', s_):
            js_props.add(camel(m.group(1) or m.group(2)))
        for m in re.finditer(r'<style>\{`(.*?)`\}</style>', s_, flags=re.S):
            for p in re.findall(r'([-\w]+)\s*:', m.group(1)): js_props.add(p)
    inline_props = js_props
    files = {}
    by_prop_token = collections.defaultdict(list)   # (prop, token) -> [(file, idx)]
    total = 0
    for f in CSS:
        text = open(f, encoding='utf8').read()
        decls = parse(text)
        files[f] = (text, decls)
        for idx, (sel, prop, a, b, imp, ctx) in enumerate(decls):
            for t in last_tokens(sel): by_prop_token[(prop, t)].append((f, idx))
            if imp: total += 1
    rows = []; redundant = collections.defaultdict(list)
    for f, (text, decls) in files.items():
        for idx, (sel, prop, a, b, imp, ctx) in enumerate(decls):
            if not imp: continue
            reason = None
            if LEGIT_AT.search(ctx): reason = 'legit-context'
            elif prop in KEEP_PROPS: reason = 'intentional-utility'
            elif prop in inline_props: reason = 'set-from-js'
            elif any(((t, prop) in inline_pairs) or (('*', prop) in inline_pairs) for t in last_tokens(sel)): reason = 'set-inline-in-jsx'
            elif prop.startswith('--'): reason = 'custom-property'
            else:
                toks = last_tokens(sel)
                # Universal / attribute / pseudo-only / :root / html / body selectors match MANY elements, so "no other rule
                # with the same class" proves nothing — these are the intentional "reset everything" rules. Never touched.
                broad = any((not last_tokens(p)) or re.search(r'(^|[\s>+~,])\*|\*$|:root|^html$|^body$|\[', p.strip()) for p in sel.split(','))
                rivals = 0
                for t in toks:
                    for (g, j) in by_prop_token[(prop, t)]:
                        if (g, j) != (f, idx): rivals += 1
                # shorthand/longhand interplay: treat any rule touching a related property as a rival
                fam = prop.split('-')[0]
                if rivals == 0 and fam in {'margin', 'padding', 'border', 'background', 'font', 'flex', 'grid', 'overflow', 'inset', 'gap'}:
                    for t in toks:
                        for (p2, t2), lst in by_prop_token.items():
                            if t2 == t and p2 != prop and p2.split('-')[0] == fam:
                                rivals += len(lst)
                if broad:
                    reason = 'contested(broad-selector)'
                elif rivals == 0:
                    reason = 'REDUNDANT'
                else:
                    reason = f'contested({rivals})'
            rows.append((f, sel, prop, reason))
            if reason == 'REDUNDANT': redundant[f].append(idx)
    cnt = collections.Counter(r[3].split('(')[0] for r in rows)
    print(f'total !important: {total}')
    for k, v in cnt.most_common(): print(f'  {k:22s} {v}')
    print('\nredundant per file:')
    for f, l in sorted(redundant.items(), key=lambda x: -len(x[1]))[:25]: print(f'  {len(l):3d}  {os.path.relpath(f, ROOT)}')
    if '--report' in sys.argv or fix:
        rp = os.path.join(ROOT, 'CSS-IMPORTANT-AUDIT.md')
        with open(rp, 'w', encoding='utf8') as w:
            w.write('# !important audit\n\nGenerated by `python3 scripts/css-audit.py --report`.\n\n')
            w.write('| Class | Count |\n|---|---|\n')
            for k, v in cnt.most_common(): w.write(f'| {k} | {v} |\n')
            w.write('\n## Every declaration\n\n| File | Selector | Property | Status |\n|---|---|---|---|\n')
            for f, sel, prop, reason in sorted(rows, key=lambda r: (r[0], r[3])):
                w.write(f'| {os.path.relpath(f, ROOT)} | `{sel[:90].replace("|", "/")}` | {prop} | {reason} |\n')
        print('wrote', rp)
    if fix:
        removed = 0
        for f, idxs in redundant.items():
            text, decls = files[f]
            edits = sorted([(decls[i][2], decls[i][3]) for i in idxs], reverse=True)
            for a, b in edits:
                seg = text[a:b]
                new = re.sub(r'\s*!\s*important\s*$', '', seg)
                text = text[:a] + new + text[b:]
                removed += 1
            open(f, 'w', encoding='utf8').write(text)
        print('removed', removed)
    if check is not None and total > check:
        print(f'FAIL: {total} !important > allowed {check}'); sys.exit(1)

main()
