# Visual regression harness (for the CSS split)

1. `npm i -D @playwright/test && npx playwright install chromium`
2. `npm run build && npx vite preview --port 4173` (leave running)
3. Baseline BEFORE touching CSS: `npx playwright test tests/visual --update-snapshots`
4. After each CSS change: rebuild, then `npx playwright test tests/visual`. Any page that changed fails with a diff image in `test-results/`.

Signed-in pages: log in once in a browser context, save it with
`npx playwright codegen --save-storage=auth.json http://localhost:4173/auth/login`, then run with
`UIP_STORAGE=auth.json UIP_PAGES=/dashboard,/messages,... npx playwright test tests/visual`.
Use a test account; the locale/theme keys are written by the spec (`uip_locale`, `uip_theme`). If a theme does not apply,
check the key in `src/context/ThemeContext.jsx`.

Not run here (no browser available): run it once on your machine and fix selectors/keys if needed.
