# Web Reporter

Chrome extension for QA engineers. Record a manual-test session locally and export a single self-contained HTML bug report to share with the developer. **No server, no cloud, no link.**

See [PLAN.md](./PLAN.md) for design.

## Status

Phase 1, in progress. Current scaffold = popup UI shell only; capture and export not wired yet.

## Develop

```bash
npm install
npm run dev
```

Then in Chrome:

1. `chrome://extensions`
2. Toggle **Developer mode** (top right).
3. **Load unpacked** → select the `dist/` folder.
4. Pin the extension from the puzzle icon for easy access.

Edit the source — the popup hot-reloads. For background or content-script changes, click the reload icon on the extension card in `chrome://extensions`.

## Build

```bash
npm run build
```

Output is `dist/`, which is the production extension.

## Icons

Drop `16.png`, `32.png`, `48.png`, `128.png` into `public/icons/` and add an `icons` block to `manifest.config.ts` when you have them. Chrome will use a default icon until then.
