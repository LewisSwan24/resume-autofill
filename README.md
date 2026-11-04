# Resume Autofill

**English** | [简体中文](README.zh-CN.md)

A local-first Chrome extension that fills in job application forms from your own resume with one click. It targets Chinese campus-recruitment sites as well as Australian and international ATS platforms.

Built with WXT 0.21, React 19 and TypeScript (Manifest V3).

## Features

- **One-click fill.** Click the floating button at the bottom right of an application page. The extension fills the form from the resume you have selected.
- **Never guesses.** Fields it is unsure about stay empty and are highlighted in yellow for you to confirm. Captchas, privacy-consent checkboxes and similar fields are left alone.
- **Fill report.** A summary card appears next to the button, and the side panel lists every field by severity. You can adopt a suggested candidate or edit a field by hand.
- **Fully local data.** Resumes, attachments and settings live in `chrome.storage.local` and IndexedDB on your machine.
- **Minimal data per frame.** The background first asks each frame which fields it found (no resume data is sent in this step), then sends only the values that frame needs. Frames without a form, such as third-party iframes, receive nothing.
- **iframes and UI libraries.** Works across iframes and drives native HTML controls, Ant Design and Element Plus components.
- **Bilingual resumes.** Keep one resume per language, for example zh-CN and en-AU, and switch the active one in the side panel. The interface itself is available in Chinese and English.

## Status and roadmap

| Milestone | Scope | Status |
|---|---|---|
| **M1** | Core engine, resume editor, side panel and floating button. 100% of fields are filled correctly on the synthetic test sites (native HTML, Ant Design, Element Plus). | Done |
| **M2** | Adapt to real ATS platforms. Greenhouse, Lever and Ashby are checked on real pages. Workday, SuccessFactors, PageUp, Moka, Beisen, Feishu Recruiting and more are still to come. | In progress |
| **M3** | AI features: resume import, drafting answers to open-ended questions, Chinese/English translation, an application tracking workspace, better file upload and general polish. | Planned |

## Install

Requires Node.js, pnpm and Chrome 114 or later (for the side panel API).

```powershell
pnpm i
pnpm build        # output goes to .output/chrome-mv3
```

Then load it into Chrome:

1. Open `chrome://extensions`.
2. Turn on **Developer mode** at the top right.
3. Click **Load unpacked** and select the `.output/chrome-mv3` folder.
4. After another `pnpm build`, click the reload button on the extension card to update.

On first install the extension seeds two sample resumes: `林知远（中文简历）` (zh-CN) and `Zhiyuan (Leo) Lin (English resume)` (en-AU).

## Try it locally

The repository includes synthetic application pages that exercise the three UI stacks.

```powershell
pnpm fixtures:build
pnpm fixtures:preview     # serves on fixed port 4173
```

Open <http://localhost:4173/> and pick a page:

| Page | Path | Sample resume to select |
|---|---|---|
| Native HTML (en-AU) | `/native/` (plus an iframe page at `/native/frame.html`) | English: `Zhiyuan (Leo) Lin` |
| Ant Design (zh-CN) | `/antd/` | Chinese: `林知远` |
| Element Plus (zh-CN) | `/element/` | Chinese: `林知远` |

Steps:

1. Click the extension icon to open the side panel and choose the matching resume in the current-resume dropdown.
2. Go back to the test page and click the floating button at the bottom right. It first shows the number of fields it detected.
3. Read the border colors on the page:
   - Green: filled.
   - Yellow: needs confirmation (several candidates, or no matching option). The field stays empty.
   - Red: not recognized, or the fill failed.
   - No border: the resume has no data for that field.
4. A summary card next to the button lists the counts and the fields that need attention. Click a field to locate it on the page.
5. The side panel holds the full report, sorted by severity and filterable by status. For a yellow row you can adopt a candidate, or click the edit icon to type a value and apply it.

The test sites contain deliberate traps that M1 is expected to leave unfilled: a captcha, a privacy-consent checkbox and a referee employee ID.

## Managing resumes

Open the options page from the extension details on `chrome://extensions`, or from the side panel.

- **Resume library:** create (pick a language), duplicate, delete and set the current resume.
- **Editor:** pages by module (basic info, contact, job intent, education, work and internships, projects, awards, language skills, referees, self-introduction). Repeating modules support adding and removing entries. Changes save automatically and invalid values are flagged in place.
- **Attachments:** resume PDF, ID photo and transcript, stored in IndexedDB and used for file inputs. Each file may be up to 10 MB.
- **Import / export:** export all resumes and settings as JSON. Importing **replaces** everything, after a confirmation. Attachment files are not part of the JSON.
- **Settings:** interface language (follow browser, Chinese, English). The "preview before fill" switch is stored but the feature is not built yet.

## Development

| Command | Purpose |
|---|---|
| `pnpm dev` | WXT development mode |
| `pnpm build` | Build the extension to `.output/chrome-mv3` |
| `pnpm zip` | Package the extension with WXT |
| `pnpm test` | Unit tests (Vitest + jsdom) |
| `pnpm test:watch` | Unit tests in watch mode |
| `pnpm test:drivers` | Build the in-page harness, then run control-driver and whole-page accuracy tests on the synthetic sites with Playwright (the extension is not loaded) |
| `pnpm e2e` | Build, then load the extension into Chromium and run the full flow on the three test sites (headless) |
| `pnpm e2e:headed` | Same as `pnpm e2e` with a visible browser window |
| `pnpm typecheck` | `wxt prepare` plus type checks for the extension and the test sites |
| `pnpm fixtures:dev` | Vite dev server for the synthetic sites |
| `pnpm fixtures:build` | Build the synthetic sites |
| `pnpm fixtures:preview` | Preview the synthetic sites on port 4173 |
| `pnpm harness:build` | Build the in-page test harness only |

## Project structure

| Path | Contents |
|---|---|
| `entrypoints/` | Extension entry points: background, content script, floating button (`fab.content`), options page, side panel |
| `src/background/` | Message routing, frame discovery, per-frame data subsetting, seeding sample resumes |
| `src/content/` | Per-frame content-script handlers and listeners |
| `src/engine/` | Field discovery, classification, grouping and fill planning |
| `src/dictionary/` | Field, option and section dictionaries (Chinese and English) |
| `src/drivers/` | Control drivers for native HTML, Ant Design and Element Plus |
| `src/fill/` | Fill runner, highlighting, report, adding repeated entry cards |
| `src/schema/` | Resume data model, field keys, migrations, sample resumes |
| `src/storage/`, `src/editor/` | Local storage (profiles and files), resume editor logic, import and export |
| `src/messaging/`, `src/i18n/` | Message protocol and guards, interface strings |
| `src/ui/` | Design system foundation: tokens, theme, fonts, icons, status vocabulary |
| `fixtures/synthetic/` | Synthetic test sites (native, Ant Design, Element Plus) |
| `tests/` | Unit tests, driver tests and end-to-end tests |

## Known limitations (M1)

- Date range pickers (one control for both start and end) are not supported. Single-date and year-month pickers are.
- Supported widgets are native HTML, Ant Design, Element Plus, react-select, and dropdowns and yes/no buttons with ARIA roles. Other libraries come later.
- On Lever, "Current location" is a search box without ARIA roles, so it is not filled yet and is marked red. Custom questions there are read only from nearby text, so most are marked yellow for review.
- There is no AI layer. Fields are recognized with dictionaries and rules, and anything unrecognized stays empty and is marked red.
- There is no preview step: one click fills the page.
- Extra entry cards (a second education, a second internship and so on) are created by recognizing the text of the page's "Add …" button. A button whose text is not in the dictionary will not be clicked.
- If a module has no add button on the page, only the existing cards are filled and extra resume entries are skipped.
- Real recruitment sites are planned for M2.

## Privacy

- Resumes, attachments and settings are stored only on your machine, in `chrome.storage.local` and IndexedDB. Nothing is uploaded to a server.
- M1 makes no network requests. The code contains no `fetch`, `XMLHttpRequest` or `WebSocket`, and no third-party analytics.
- Content scripts run in the default ISOLATED world, so page scripts cannot read the extension's variables.
- Resume data never goes through `window.postMessage`. Content scripts, the background and the side panel talk only over the extension's own channel (`chrome.runtime`).
- Data is sent on demand. The background first asks each frame which fields it recognized (no resume data in that step), then sends each frame only the matching values. Frames without a form get nothing, and attachments go only to frames that have a file input.
- The extension does not announce itself to pages through `window.postMessage` (the WXT content-script-started message is disabled), so pages cannot learn the extension ID.
- Permissions are `storage`, `unlimitedStorage`, `sidePanel` and `webNavigation` (to list the frames of a tab). The `tabs` permission is not requested.
- The `<all_urls>` host permission is required because the extension has to recognize and fill forms on any recruitment site.

## Design system

All three surfaces (options page, side panel and the floating button on pages) share one design system, adapted from the author's "Lively Icons": quiet screens, icon first, `paper` / `surface` / `tile` layers separated by 1px lines, no drop shadows. The foundation lives in `src/ui/`:

| File | Contents |
|---|---|
| `tokens.ts`, `theme.css` | The design tokens (`--raf-*` custom properties) |
| `fonts.css` | Bundled web fonts for the extension pages |
| `Icon.tsx` | Inline SVG icons (Bootstrap Icons) |
| `status.ts` | One tone, icon and word per fill outcome |

- **Tokens.** Changing the look takes edits to `tokens.ts` and `theme.css` only. Keep them in sync: `tests/unit/ui/tokens.test.ts` checks that names and values match, separately for the light block and the dark block, and that the three surfaces use no hard-coded colors or undefined tokens. Naming: colors use `--raf-color-*`. Other groups are `--raf-font-*`, `--raf-radius-*`, `--raf-space-*`, `--raf-shadow-*`, `--raf-motion-*`, `--raf-z-*` and `--raf-size-*`. Weights are only 400 and 600, shadows are `none`, motion is 320 ms spring (`--raf-motion-move`), 160 ms (`--raf-motion-settle`) and 120 ms (`--raf-motion-duration`).
- **Dark mode.** It follows the system setting (`prefers-color-scheme`) and has no toggle. `theme.css` declares the light values first and the dark colors inside a `@media (prefers-color-scheme: dark)` block. Dark has no hue except the status colors (danger, success, warning). The floating button follows the system theme too, not the theme of the page it sits on.
- **Fonts.** Manrope (400 and 600) is used for interface text and ZCOOL KuaiLe only for page titles (`--raf-font-display`). Both come from npm (`@fontsource/*`), are bundled into the build and make no network request. `src/ui/fonts.css` is imported by the options page and the side panel only. The floating button lives in a shadow root on someone else's page, where `@font-face` does not work and would have to be added to the page itself, so it registers no fonts: it uses Manrope if it happens to be installed and otherwise the system stack (`Noto Sans SC`, `PingFang SC`, `Microsoft YaHei`, `system-ui`). Manrope only covers Latin letters, so Chinese text is unaffected.
- **Icons.** `<Icon name="check-circle" />` renders inline SVG from the `bootstrap-icons` package. Only the icons listed in the `ICONS` registry in `Icon.tsx` are bundled, so a new icon is imported and registered there. Icons are decorative (`aria-hidden`) unless you pass `label`. Status icons always appear next to a word.
- **Status.** `OUTCOME_STATUS` in `status.ts` maps each fill outcome to a tone (success, warning, danger, muted), an icon and a word (`status.*` in `src/i18n`), so a state is never shown by color alone.
- **Page highlights.** The outlines on the page's own fields are inline styles and cannot use CSS variables. Their three colors are the `HIGHLIGHT_COLORS` constant in `tokens.ts`. The line style also differs by state: filled is 2px solid, needs review is 2px dashed and failed is 3px solid.
- **Extension icons.** `public/icon/*.png` are rendered from the design-system drafts (accent `#0066cc` tile, white `file-earmark-check` glyph, bolder `check-lg` at 16 and 32 px). Run `node scripts/render-icons.mjs` to regenerate them (needs Playwright Chromium).