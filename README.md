# Tune Notebook

A tiny offline web app for catching melody ideas while you walk. Tap **Record**, hum or whistle, tap **Stop**. Nothing gets between you and the idea: no tempo or key setup, the mic is recorded as is.

Plain HTML/CSS/JS, no build step, no backend. Hosted on GitHub Pages, installed to the iPhone Home Screen.

**Live app:** <https://ravi-annaswamy.github.io/tune-notebook/> · **Repo:** <https://github.com/ravi-annaswamy/tune-notebook>

## How to use it

1. **Record**: one tap. The mic starts right away (the first time, iOS asks for permission). The screen shows a big timer, a level meter, and a large **Stop & save** button.
2. Sing, hum or whistle. Useful habit: **clap or tap the beat** and **sing your Sa** at the start. It's all in the recording, so tempo and key can be worked out from the audio later.
3. **Stop & save**. The tune shows at the top of the list, and a moment later it's **analysed automatically** in the background (on the phone, offline): BPM, Sa and scale appear on the row.

**Prompt: compose over a random groove.** Tap **Prompt** under Record. The card has six lines; tap one to change just that part:
- **Style** steps through 5 bands, all synthesized on the phone so they work offline:
  - **Acoustic:** guitar.
  - **Pop:** guitar, bass, drums.
  - **Rock:** overdriven power chords, bass, drums.
  - **Synth pop:** pad, arpeggio, synth bass, drum machine.
  - **Ballad:** guitar, pad, long bass notes.
- **Tempo** (a random BPM suited to the style), **Sa** (any of 12 keys), **Chords** (14 progressions: pop I–V–vi–IV, 50s, folk, ii–V–I, Khamaj/Mixolydian, Asavari "epic minor", Andalusian, Kafi/Dorian vamp, Bhairavi colour, a Sa–Pa drone and more).
- **Feel** steps through the style's groove patterns, 23 in all:
  - **Acoustic:** let it ring, steady strum, folk strum, syncopated strum, island offbeat with shaker, fingerpicked, Travis picking. In 3/4: waltz, strum, folk strum, fingerpicked.
  - **Pop:** syncopated, driving 8ths, half-time, offbeat skank.
  - **Rock:** palm-muted 8ths, big open chords, gallop.
  - **Synth pop:** 16th arpeggio, four on the floor, dreamy.
  - **Ballad:** picked, ring, waltz.
- **Form**:
  - **16 bars: A + B** (default). **A** is sparse: each chord rings for 2 bars. **B** moves a chord per bar and brings in **one new colour chord** (ii, iii, iv, ♭VI, ♭VII…, outlined on screen), then turns around back to the top. The drums add a crash at each section, a fill at the end of each section, and busier hats in B.
  - **Loop:** the old 4-bar loop.
- **Shuffle** keeps your style and changes everything else. A new prompt starts in the style you used last. **Listen** previews it; changes apply while it plays.
- **Record over it**: a **2-bar count-in** of clicks (beat 1 accented, a big 1-2-3-4 on screen), then the band comes in on bar 1 and **recording starts by itself**. **Cancel** during the count-in saves nothing. While recording you see all 16 bars as a chord map with the current bar lit, "Part A · bar 3 of 8", and toggles for **Click / Drums / Bass / Chords** (the click starts off when there are drums; mutes are recorded too).
- The backing is **in the recording**, so a shared clip has its band. Earphones keep the mic clean. The backing is delayed by the measured audio latency so it lines up with your voice.
- The tune is saved with its style, feel, BPM, Sa, scale, both parts' chords and the new chord. **Use this prompt again** in its details brings the same groove back. Prompts saved by v1.3 replay as the acoustic loop they were.

**Analysis** (tap the grey line under a tune's name to open it):
- **Tempo** from your clicks, with the range it moved within. No clicks means no tempo.
- **Time signature**, only when beat 1 is louder (clap on 1, click on the others). Even clicks can't show it.
- **Sa**: up to four candidates, best guess first. Tap one to choose it; your choice is kept even if you analyse again. The row, scale, swaras and sargam follow your choice.
- **Scale** (thaat or pentatonic raga, with the Western name), the **swaras** you used, your **tuning** relative to A440 (whistles are often a bit flat; notes are named relative to *your* pitch), and a **sargam sketch** (`'` upper octave, `.` lower, `—` held beat).
- **Analyse again** re-runs it. Tunes recorded before this version, imported ones and recovered takes are analysed automatically when the app opens.

Analysis never runs while you're recording, and it runs in a background thread so the app stays responsive. Tempo and Sa set with v1.0's tap-tempo/Set Sa buttons are kept, never overwritten.

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
js/pitch.js           YIN pitch detection + note naming
js/analyze.js         melody analysis shared by app and CLI: clicks → tempo/meter; pitch → tuning, Sa, scale, sargam
js/analysis-client.js decodes a clip (Web Audio) and runs the analysis in the worker, queue-free API
js/analyze-worker.js  Web Worker wrapper around analyze.js
js/prompt.js          Prompt mode, pure: genres, feels, progressions, 16-bar A/B form, voicings, per-beat arrangement
js/prompt-player.js   Prompt scheduler: count-in, lookahead timing, chord/bar position for the screen
js/instruments.js     synthesized band: clean/overdriven guitar, finger/synth bass, drums, pad, arpeggio, click
tools/serve.py        local dev server with caching disabled (npm run serve)
js/db.js              IndexedDB (tunes, audio, in-progress chunks)
js/zip.js             zip writer/reader for backups
icons/                app icons (regenerate with tools/make_icons.py, needs Pillow)
tools/analyze-tune.mjs  same analysis from the command line: node tools/analyze-tune.mjs file.m4a (macOS afconvert)
tests/unit.test.mjs   node tests for pitch + zip  (npm test)
tests/analyze.test.mjs analysis tests: synthetic takes + your confirmed takes if samples/ has the backup
tests/prompt.test.mjs  prompt tests: form rules, genres/feels, arrangement per style, count-in timing, tuning, old prompts
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

**v1.4.0 (2026-10-18), styles, sounds and 16-bar form:** `npm test` passes 28/28:
- Across all 14 progressions × 8 colour choices: A changes chord at most 4 times, B moves more and contains the marked new chord, and bar 16 is the turnaround.
- Every feel's patterns exist and fit its meter. In Rock: power chords, bass on the roots, a crash at bars 1 and 9, 4-hit snare fills in bars 8 and 16, and busier hats in B. In Synth pop: pads cover all 16 bars and the arpeggio plays 16 notes a bar.
- Plucked strings from E1 to E5 are in tune within 5 cents for 200 random plucks.
- Count-in: only 8 clicks, then kick + bass + guitar + crash together on bar 1.
- v1.3 prompts replay unchanged.

In the browser (no-cache server, fresh origin):
- The Style line cycles through all 5 styles, and the preview plays A1–A8 then moves into B on time with no errors.
- Rendering each style offline, part by part, set the mix: drums, bass and chords within about 5 dB of each other, the styles within about 5 dB overall, and peaks ≤ 0.6.
- Record over it showed the 16-bar map with the new chord outlined. Muting Drums mid-take worked, and the tune saved its style/feel/form/chords.

Not tried on an iPhone yet: how the band sounds on the phone speaker, and CPU headroom for the busier styles.

**v1.3.1 (2026-10-18), count-in:** `npm test` 23/23. Using a stand-in audio engine: a 2-bar count-in is exactly 8 clicks in 4/4 (6 in 3/4), accented on beat 1, with no guitar until the downbeat. The first strum and chord 1 land on the downbeat, and the preview (no count-in) starts at once. In the browser: Listen → Record over it showed "Count-in 1/2" with a big beat number and Cancel, and the recorder only started after the count-in. In the decoded take, sound starts at 0.045 s and the first chord's root is present in the first second. Cancel and an audio interruption during the count-in both save nothing, and plain Record is still instant.

**v1.3.0 (2026-10-18), Prompt mode:** `npm test` passes 20/20 (500 random prompts valid, rerolls change only one part, D pop = D A Bm G, all 36 voicings have the root in the bass, the right third and a guitar range, plucked strings within 8 cents from E2 to E5). In the browser: the preview beat lands every 0.732 s at 82 BPM, and changing chords mid-preview keeps it playing. Recording over it hands the running groove to the recorder without a restart, shows the live chord and beat, and saves BPM/Sa/chords. Decoding the take and running the app's analyser on it gave 82.2 BPM with 4/4 accents and the guitar clearly present, so the backing is really in the file. Mic denied during a preview stops the groove. Plain Record is unchanged (raw mic, no backing). Not yet tried on an iPhone: the speaker/earphone balance and how the latency compensation feels with Bluetooth.

**v1.2.0 (2026-10-18), in-app analysis:** `npm test` passes 13/13. A synthetic whistled D-major phrase, 30 cents flat with clicks at 90 BPM, gives 90 BPM, −30¢, Sa D, Bilaval and the right sargam. Accented every-3rd click gives 3/4. No clicks gives no tempo but still finds Sa. Silence doesn't crash. Your three confirmed takes still give 85/86/96 BPM and Sa A#/C#/D#. In the browser: importing the backup analysed all three in about 2 s in the Web Worker (0 main-thread fallbacks, longest frame gap 9 ms). Choosing a different Sa is saved and survives "Analyse again". A new recording is analysed automatically right after Stop (fake mic at 90 BPM with Sa G gave 90 BPM, Sa G). Not yet timed on an iPhone.

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
> Then: "on mac. when I run, I recoreded a tune, but when doe analyze run?" → "Do this task here: Add in-app Analyse button for tempo and Sa"
>
> Then: "can you build an option Prompt, that plays a pulse at any random reasonable tempo and a guitar chord or progression? and lets me compose over it?"
>
> Then: "from prompt listen when i click record over it, there should be a 2 bar count in and automatically starting to record."
>
> Then: "that is awesome, can you add more variety in sounds, may be a bass, maybe styles, like synth pop, rock, pop, etc, and more strum styles? or may be you can have two eight bar pattersn, the first is sparse in change, the second has a good introduction of one more chord etc, so that the 16 bars are a nice loop to compose with"
>
> Earlier: "Setting tempo and Sa makes the capturing of the tune interrupting flow. How about just capturing it as is, I will probably click the tempo to start with and sing the sa note, as part of recording, later we can figure out a way to recover the tempo and time signature and key signature and scale from melody itself"
