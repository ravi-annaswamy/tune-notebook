# Tune Notebook: notes for Claude

- Static PWA, no build. Entry: index.html → js/app.js (ES modules). Audio engine: js/audio.js. Pitch: js/pitch.js. Storage: js/db.js. Zip: js/zip.js. SW: sw.js (bump VERSION on every change that ships).
- Tests: `npm test` (node --test tests/). Dev server: `.claude/launch.json` → tools/serve.py :8080 (sends Cache-Control: no-store; plain `python3 -m http.server` let the browser reuse stale ES modules and gave false test results).
- When testing in the browser pane: the service worker serves cached files. Unregister it and clear caches before reloading after code edits.
- Don't rely on the <dialog> 'close' event (it didn't fire in the pane's WebView); resolve from the button clicks.
- Log progress in project_log.md with timestamps (user's global rule).
