// Visual safety net for the CSS work.  Run BEFORE any CSS change to record the baseline, and AFTER to compare:
//   npm i -D @playwright/test && npx playwright install chromium
//   npm run build && npx vite preview --port 4173 &      (the app proxies /api to your backend)
//   npx playwright test tests/visual --update-snapshots   # first run = baseline
//   npx playwright test tests/visual                      # later runs fail on any pixel difference
// Public pages need no login. For signed-in pages set UIP_STORAGE=path/to/storageState.json (see README-VISUAL.md).
import { test, expect } from '@playwright/test';

const BASE = process.env.UIP_BASE || 'http://localhost:4173';
const PUBLIC = ['/', '/auth/login', '/auth/register', '/auth/forgot-password', '/privacy-policy', '/403', '/500'];
const SIGNED_IN = (process.env.UIP_PAGES || '/dashboard,/student/dashboard,/student/courses,/messages,/notifications').split(',').filter(Boolean);

const combos = [];
for (const locale of ['en', 'ar']) for (const theme of ['light', 'dark']) for (const size of [{ w: 1366, h: 800, n: 'desktop' }, { w: 390, h: 844, n: 'phone' }]) combos.push({ locale, theme, size });

function pages() { return process.env.UIP_STORAGE ? [...PUBLIC, ...SIGNED_IN] : PUBLIC; }

for (const { locale, theme, size } of combos) {
  test.describe(`${locale}-${theme}-${size.n}`, () => {
    test.use({
      viewport: { width: size.w, height: size.h },
      storageState: process.env.UIP_STORAGE || undefined,
    });
    for (const path of pages()) {
      test(path, async ({ page }) => {
        await page.addInitScript(([l, t]) => {
          try { localStorage.setItem('uip_locale', l); localStorage.setItem('uip_theme', t); } catch {}
        }, [locale, theme]);
        await page.goto(BASE + path, { waitUntil: 'networkidle' });
        await page.evaluate(() => document.fonts && document.fonts.ready);
        await expect(page).toHaveScreenshot(`${path.replace(/\W+/g, '_') || 'home'}.png`, {
          fullPage: false, animations: 'disabled', maxDiffPixelRatio: 0.002,
        });
      });
    }
  });
}
