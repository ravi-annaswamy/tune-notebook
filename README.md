# Tune Notebook

A tiny offline web app for catching melody ideas while you walk. Tap **Record**, hum or whistle, tap **Stop**. Nothing gets between you and the idea: no tempo or key setup, the mic is recorded as is.

Plain HTML/CSS/JS, no build step, no backend. Hosted on GitHub Pages, installed to the iPhone Home Screen.

**Live app:** <https://ravi-annaswamy.github.io/tune-notebook/> · **Repo:** <https://github.com/ravi-annaswamy/tune-notebook>

## How to use it

1. **Record**: one tap. The mic starts right away (the first time, iOS asks for permission). The screen shows a big timer, a level meter, and a large **Stop & save** button.
2. Sing, hum or whistle. Useful habit: **clap or tap the beat** and **sing your Sa** at the start. It's all in the recording, so tempo and key can be worked out from the audio later.
3. **Stop & save**. The tune shows at the top of the list.

In the list: tap the **name** to rename, **▶** to play or pause (tap the bar to seek), **share** to send the audio file to Files, WhatsApp, Drive and so on, and **trash** to delete (asks first).

**Backup** (⋯ menu):
- **Export all as .zip**: the first tap builds the zip, the second tap shares or saves it. Includes every clip plus `tunes.json` with names, dates and durations.
- **Share one by one**: one share sheet per tune.
- **Import**: takes that zip (or loose audio files) to restore. Tunes already on the phone are skipped.

## Files

```
index.html            the single page
styles.css            dark/light styles, big touch targets, safe areas
manifest.json         PWA manifest
sw.js                 service worker (offline cache). Bump VERSION on each deploy
js/app.js             UI, record flow, list, share/export/import, recovery
js/audio.js           mic capture (MediaRecorder), level meter, interruption detection
js/pitch.js           YIN pitch detection + note naming (not loaded by the app; kept for future tempo/key analysis)
js/db.js              IndexedDB (tunes, audio, in-progress chunks)
js/zip.js             zip writer/reader for backups
icons/                app icons (regenerate with tools/make_icons.py, needs Pillow)
tools/analyze-tune.mjs  offline analysis: clicks → tempo, whistle → Sa, scale, sargam (node, macOS afconvert)
tests/unit.test.mjs   node tests for pitch + zip  (npm test)
.nojekyll             tells GitHub Pages to serve files as-is
```

## Deploy to GitHub Pages

You need a free GitHub account. Pick **one** of the two ways.

### Option A: upload in the browser (no git needed)

1. Go to <https://github.com/new>. Repository name: `tune-notebook`. Visibility: **Public** (Pages on private repos needs a paid plan). Click **Create repository**.
2. On the new repo page click **uploading an existing file**.
3. In Finder, open the `tune-notebook` folder, select **everything inside it** (`index.html`, `styles.css`, `manifest.json`, `sw.js`, `.nojekyll`, and the `js` and `icons` folders), and drag it onto the page. Press <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>.</kbd> in Finder to show the hidden `.nojekyll` file. Click **Commit changes**.
4. Open **Settings → Pages**. Under **Build and deployment**, set Source to **Deploy from a branch**, Branch to **main**, folder to **/ (root)**. Click **Save**.
5. Wait 1–2 minutes and refresh that Settings page. It shows **Your site is live at `https://<your-username>.github.io/tune-notebook/`**.

### Option B: git from Terminal

```bash
cd ~/projects/tune-notebook
```
```bash
git init -b main && git add . && git commit -m "Tune Notebook"
```
```bash
gh repo create tune-notebook --public --source=. --push
```
(Without the `gh` tool: create the empty repo on github.com, then `git remote add origin https://github.com/<you>/tune-notebook.git` and `git push -u origin main`.) Then do step 4 above.

### Updating later

1. Edit the files.
2. **Open `sw.js` and bump `VERSION`** (e.g. `v1.0.0` → `v1.0.1`). Without this, phones keep running the cached old version.
3. Upload or push again. Next time you open the app it shows **"A new version is ready → Update"**. Tap it (never mid-recording).

## Install on iPhone

1. Open **Safari** (it has to be Safari) and go to **<https://ravi-annaswamy.github.io/tune-notebook/>**.
2. Tap the **Share** button (square with an up arrow) in the toolbar. On iOS 26 it may be under the **⋯** button.
3. Scroll down and tap **Add to Home Screen**. Leave **Open as Web App** on, then tap **Add**.
4. Open **Tunes** from the Home Screen. Tap **Record** once and **Allow** the microphone.
5. Open it once more while online so the offline cache finishes. After that it works in airplane mode.

**Why install instead of using a Safari tab:** Safari can delete website data you haven't opened in 7 days. Home Screen apps are exempt, and the app also asks for persistent storage. Still, **export a backup now and then** (⋯ → Export all), since deleting the app from the Home Screen deletes its tunes.

### Tips for walking

- The mic records as is: echo cancellation, noise suppression and auto-gain are off, because they flatten hums and whistles. In strong wind, cup the phone or turn away from the wind.
- The **silent switch** doesn't block playback in the list (the app plays as media).
- The screen stays on while recording (Wake Lock, iOS 16.4+, reliable in Home Screen apps from iOS 18.4). If the app shows "Screen may auto-lock", set **Settings → Display & Brightness → Auto-Lock** longer. **Locking the phone or switching apps ends the recording** (iOS turns off web-app mics in the background). The app saves everything up to that moment.

## Edge cases and how they're handled

| Situation | What happens |
|---|---|
| **Mic permission denied** | A sheet explains exactly where to re-enable it (Safari ᴀA → Website Settings, or Settings → Apps → Safari → Microphone). Nothing breaks; tap Record again after allowing. |
| Mic busy (call/FaceTime/Voice Memos) | "Microphone is busy" sheet. |
| No mic / unsupported browser / not HTTPS | Clear message instead of a crash. |
| **Phone call (or Siri/alarm) mid-recording** | iOS suspends audio and mutes the mic. The app detects it (`AudioContext` state `interrupted`/`suspended`, track `mute` >1.2 s, track `ended`), stops, and **saves what was recorded**: "Interrupted by a call… Saved 0:42". |
| App killed, crashed, or battery died mid-take | Audio is written to IndexedDB every second while recording. On next launch the take is rebuilt and listed as "… (recovered)". |
| App sent to background / screen locked (iOS) | Recording is stopped and saved immediately. |
| **Very short clip** (< 1 s or nearly empty) | Not saved: "Too short to keep." No clutter, no leftover data. |
| Double-tapping Record/Stop | Ignored while starting/stopping (state machine). |
| Share needs a fresh tap on iOS | Audio is preloaded as your finger touches the button. If iOS still refuses, the app says "Ready. Tap Share again". |
| Storage error while saving | The take stays in the recovery store and is restored on next launch. |

### What was tested

**v1.1.0 (2026-10-18), simplified capture:** recording screen shows only timer, meter and Stop. Verified the mic is requested with echo cancellation, noise suppression and auto-gain off. The saved file is the clean mic signal: the test tone is present and there's no click or drone energy. Phone-call interruption, mic `ended`, short clip (0.4 s) and crash recovery all still behave as below. Older tunes that have BPM/Sa still show them.

**v1.0.0 (2026-10-17), with tap tempo and drone (since removed):**

Automated in desktop Chromium (mobile viewport) with a synthetic mic signal, plus `npm test` (7 node unit tests: YIN accuracy within 15 cents from 82–880 Hz, silence/noise rejection, semitone snapping with octave-error outliers, zip round trip, CRC):

- Mic denied → help sheet, app stays usable.
- Full flow: 6 taps at 652 ms → **92 BPM**. Singing C#3 (138.6 Hz) → **Sa C#**. Decoding the saved file showed clicks every 0.650–0.660 s, and drone energy at Pa (207.9 Hz) rose ~10× right after Sa was set, so **the click and drone are really in the recording**.
- Recorded as `audio/mp4` (AAC), decodes to the right length.
- Very short clip (0.4 s) → discarded, no leftover data.
- Simulated call (audio context suspended) and mic `ended` → stopped and saved with a message.
- Page reloaded mid-recording → recovered on next launch, and the truncated file still decodes.
- Play/pause/progress, rename, delete (cancel and confirm), export zip → delete all → import → **identical** metadata and audio. Re-import skips duplicates. The zip passes `unzip -t`.
- Server stopped → app loads from the service worker with all tunes.

**Not verifiable off-device; please check on your iPhone:** a real phone call mid-recording, the iOS share sheet (Files/WhatsApp), Wake Lock in the installed app, and recording quality outdoors.

## Development

```bash
python3 -m http.server 8080
```
Open <http://localhost:8080>. Run tests with `npm test`. The service worker caches files aggressively: during development use DevTools → Application → "Update on reload", or bump `VERSION` in `sw.js`.

To try it on your iPhone before deploying, the page must be served over HTTPS (the mic needs a secure context), so deploying to GitHub Pages is the easiest way.

---

## Build brief (original prompt)

> Build a mobile-first Progressive Web App called "Tune Notebook" for capturing melody ideas while walking. Target: iPhone Safari, installed to home screen. Host on GitHub Pages (static files only, no backend). Plain HTML/CSS/JS, no build step.
>
> SCREEN (single page): Top: large Record button (one tap to start). Below: list of saved tunes, newest first. Each row: name (default = date/time, tap to rename), BPM, Sa note, duration, Play/Pause, Share, Delete (with confirm).
>
> RECORD FLOW: 1. Tap Record -> mic permission (getUserMedia), recording starts immediately. 2. "Tap tempo" button: user taps 4+ times; compute BPM from average interval; start a soft metronome click at that BPM. Allow re-tapping to adjust. 3. "Set Sa" button: user sings the root for ~2 seconds; detect pitch (autocorrelation or YIN via Web Audio AnalyserNode); snap to nearest semitone; show note name (e.g. "C#") and start a tanpura-style drone (Sa + Pa + upper Sa, gentle plucked/sustained timbre synthesized with Web Audio). 4. User hums/whistles the tune. Click and drone ARE included in the recording (mix mic + click + drone into one stream via MediaStreamDestination). 5. Tap Stop -> save clip.
>
> STORAGE: Save audio blobs + metadata (name, timestamp, BPM, Sa, duration) in IndexedDB. Use MediaRecorder with audio/mp4 (iPhone-compatible); fall back to webm elsewhere. Request navigator.storage.persist() to reduce eviction risk. Share button uses Web Share API to send the audio file (to Files, WhatsApp, Drive). Add an "Export all" option (zip or sequential shares) for backup.
>
> PWA: manifest.json + service worker so the app works fully offline. Large touch targets, usable one-handed while walking; dark mode friendly. Keep screen awake while recording (Wake Lock API where supported).
>
> DELIVER: the full file set, plus step-by-step instructions to deploy on GitHub Pages and add to the iPhone home screen. Test edge cases: mic denied, recording interrupted by a phone call, very short clips.
>
> Follow-up during the build: "what is happening why still stuck on step 1?"
>
> Then: "Yes, create the tune-notebook GitHub repo and deploy it to GitHub Pages."
>
> Then: "Setting tempo and Sa makes the capturing of the tune interrupting flow. How about just capturing it as is, I will probably click the tempo to start with and sing the sa note, as part of recording, later we can figure out a way to recover the tempo and time signature and key signature and scale from melody itself"
