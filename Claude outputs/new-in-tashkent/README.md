# New in Tashkent — offline bundle

A complete A1→C2 English course: 168 units, 37,203 exercises, 5,948 words,
168 story episodes. Everything runs in your browser; nothing is sent anywhere.

## Run it

Browsers refuse to `fetch` local files, so open it over http rather than by
double-clicking `index.html`:

    cd new-in-tashkent
    python3 -m http.server 8000

then open <http://localhost:8000>. Any static server works.

## Speech

No audio has been recorded for this course — about 20,800 files are referenced
and none exist — so every listening and pronunciation exercise is spoken by
synthesis. Two options, in Settings:

* **Your browser's built-in voice** (default). No key, works offline, sounds
  robotic. Pick the voice from the dropdown.
* **Gemini TTS.** Paste your own API key from <https://aistudio.google.com/apikey>.
  It is stored only in this browser's `localStorage` and goes nowhere but Google.
  Each phrase is fetched once and cached for the session.

Google Translate's speech endpoint cannot be used from a web page at all — it
refuses cross-origin requests — so it is not offered.

Gemini works in this bundle. It does **not** work in the published web version:
that page's security policy blocks requests to any host outside its own.

## What is here

    index.html        the whole app — no build step, no dependencies
    data/index.json   course map and instruction strings
    data/u001..u168   one file per unit: items, vocabulary, grammar, story

Data is regenerated from the course repo with `tools/pack_app.py`.

## Progress

Kept in `localStorage`, per browser. "Reset progress" in Settings clears it.
