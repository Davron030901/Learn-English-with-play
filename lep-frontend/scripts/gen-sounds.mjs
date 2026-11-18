#!/usr/bin/env node
/**
 * Synthesises the app's sound effects into small 16-bit mono WAV files under assets/sfx/.
 *
 * No samples, no downloads, no licences: every sound is additive synthesis (a few sine
 * partials with a bell-like or plucked envelope) computed here, so the set is reproducible
 * byte for byte (`npm run gen:sounds`). The palette is deliberately soft — a wrong answer is
 * a gentle low tone, never a buzzer (docs/10 §8: no manufactured anxiety) — and short, so a
 * sound never delays the next item (docs/10 §10: celebration must not add latency).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RATE = 22_050;
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'sfx');

const midi = (n) => 440 * 2 ** ((n - 69) / 12);
const C5 = 72;

/** A deterministic noise source (xorshift), so the build is reproducible. */
function noise(seed = 0x9e3779b9) {
  let x = seed >>> 0;
  return () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return (x / 0xffffffff) * 2 - 1;
  };
}

function buffer(seconds) {
  return new Float32Array(Math.ceil(seconds * RATE));
}

/**
 * One note: a fundamental plus partials, with a fast attack and an exponential decay.
 * `bell` adds inharmonic partials (2.76×, 5.4×) for a glassy chime; otherwise the partials are
 * harmonic (a soft marimba-like pluck).
 */
function note(buf, { at, freq, dur, gain = 0.5, decay = 6, bell = false, attack = 0.004, glide = 0 }) {
  const start = Math.floor(at * RATE);
  const len = Math.floor(dur * RATE);
  const partials = bell
    ? [
        [1, 1],
        [2.76, 0.35],
        [5.4, 0.12],
        [8.93, 0.05],
      ]
    : [
        [1, 1],
        [2, 0.28],
        [3, 0.1],
        [4, 0.04],
      ];
  for (let i = 0; i < len && start + i < buf.length; i += 1) {
    const t = i / RATE;
    const env = Math.min(1, t / attack) * Math.exp(-decay * t);
    const f = freq * (1 + glide * (t / dur));
    let s = 0;
    for (const [mul, amp] of partials) s += amp * Math.sin(2 * Math.PI * f * mul * t);
    buf[start + i] += gain * env * s;
  }
}

/** Filtered noise burst — a soft "pop" or the air of a whoosh. */
function puff(buf, { at, dur, gain = 0.2, lowpass = 0.15, seed = 1 }) {
  const rnd = noise(seed);
  const start = Math.floor(at * RATE);
  const len = Math.floor(dur * RATE);
  let y = 0;
  for (let i = 0; i < len && start + i < buf.length; i += 1) {
    const t = i / RATE;
    const env = Math.sin(Math.PI * (t / dur)) ** 2;
    y += lowpass * (rnd() - y);
    buf[start + i] += gain * env * y;
  }
}

/**
 * A plucked string (Karplus–Strong): a lowpassed noise burst circulating in a delay line with
 * damping — the dutar. Deterministic: the excitation comes from the seeded noise source.
 */
function pluck(buf, { at, freq, dur, gain = 0.5, damping = 0.996, seed = 5, brightness = 0.5 }) {
  const rnd = noise(seed);
  const period = Math.max(2, Math.round(RATE / freq));
  const line = new Float32Array(period);
  let y = 0;
  for (let i = 0; i < period; i += 1) {
    y += brightness * (rnd() - y);
    line[i] = y;
  }
  const start = Math.floor(at * RATE);
  const len = Math.floor(dur * RATE);
  let idx = 0;
  for (let i = 0; i < len && start + i < buf.length; i += 1) {
    const next = (idx + 1) % period;
    const v = line[idx];
    line[idx] = damping * 0.5 * (line[idx] + line[next]);
    idx = next;
    buf[start + i] += gain * v * Math.min(1, i / (0.002 * RATE));
  }
}

/** One-pole filters over a span of the buffer, for shaping noise. */
function bandNoise(buf, { at, dur, gain = 0.2, low = 0.6, high = 0.1, seed = 9, env = 'decay', decay = 40 }) {
  const rnd = noise(seed);
  const start = Math.floor(at * RATE);
  const len = Math.floor(dur * RATE);
  let lp = 0;
  let hp = 0;
  let prev = 0;
  for (let i = 0; i < len && start + i < buf.length; i += 1) {
    const t = i / RATE;
    lp += low * (rnd() - lp); // lowpass
    hp = (1 - high) * (hp + lp - prev); // highpass
    prev = lp;
    const e = env === 'swell' ? Math.sin(Math.PI * (t / dur)) ** 2 : Math.exp(-decay * t) * Math.min(1, t / 0.002);
    buf[start + i] += gain * e * hp;
  }
}

/**
 * A doira (frame drum) stroke: a sine whose pitch drops, a bandpassed slap, and the high jingle
 * ticks of the rings set in the frame.
 */
function drum(buf, { at, gain = 0.6, from = 110, to = 70, jingles = 4, seed = 13 }) {
  const start = Math.floor(at * RATE);
  const len = Math.floor(0.35 * RATE);
  let phase = 0;
  for (let i = 0; i < len && start + i < buf.length; i += 1) {
    const t = i / RATE;
    const f = to + (from - to) * Math.exp(-t / 0.04);
    phase += (2 * Math.PI * f) / RATE;
    buf[start + i] += gain * Math.exp(-18 * t) * Math.min(1, t / 0.002) * Math.sin(phase);
  }
  bandNoise(buf, { at, dur: 0.03, gain: gain * 0.6, low: 0.5, high: 0.3, seed, decay: 80 });
  for (let j = 0; j < jingles; j += 1) {
    bandNoise(buf, { at: at + 0.01 + j * 0.025, dur: 0.015, gain: gain * 0.18, low: 0.95, high: 0.9, seed: seed + j + 1, decay: 120 });
  }
}

/** A sine glide from one frequency to another (a phase accumulator, so no clicks). */
function glide(buf, { at, from, to, dur, gain = 0.4 }) {
  const start = Math.floor(at * RATE);
  const len = Math.floor(dur * RATE);
  let phase = 0;
  for (let i = 0; i < len && start + i < buf.length; i += 1) {
    const t = i / RATE;
    const f = from * (to / from) ** (t / dur);
    phase += (2 * Math.PI * f) / RATE;
    const env = Math.min(1, t / 0.005) * Math.min(1, (dur - t) / 0.01);
    buf[start + i] += gain * env * Math.sin(phase);
  }
}

/** A short room: two feedback delays, mixed low, so chimes do not sound dry. */
function room(buf, { mix = 0.18 } = {}) {
  const out = Float32Array.from(buf);
  for (const [delay, fb] of [
    [0.031, 0.35],
    [0.047, 0.3],
  ]) {
    const d = Math.floor(delay * RATE);
    const line = new Float32Array(buf.length);
    for (let i = 0; i < buf.length; i += 1) {
      line[i] = buf[i] + (i >= d ? fb * line[i - d] : 0);
    }
    for (let i = 0; i < buf.length; i += 1) out[i] += mix * (i >= d ? line[i - d] : 0);
  }
  return out;
}

function normalise(buf, peak = 0.7) {
  let max = 0;
  for (const s of buf) max = Math.max(max, Math.abs(s));
  if (max === 0) return buf;
  const k = peak / max;
  // Fade the last 8 ms so no file ends on a click.
  const fade = Math.floor(0.008 * RATE);
  return buf.map((s, i) => s * k * Math.min(1, (buf.length - 1 - i) / fade));
}

function wav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(s * 32767))), i * 2));
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

const SOUNDS = {
  /** Correct answer: two bright rising bell notes (a major sixth). */
  correct() {
    const b = buffer(0.42);
    note(b, { at: 0, freq: midi(C5 + 7), dur: 0.3, gain: 0.45, decay: 9, bell: true });
    note(b, { at: 0.075, freq: midi(C5 + 16), dur: 0.34, gain: 0.5, decay: 8, bell: true });
    return room(b);
  },
  /** Wrong answer: a soft, low two-note fall. Informative, not punishing. */
  incorrect() {
    const b = buffer(0.38);
    note(b, { at: 0, freq: midi(C5 - 8), dur: 0.18, gain: 0.45, decay: 14 });
    note(b, { at: 0.11, freq: midi(C5 - 12), dur: 0.26, gain: 0.4, decay: 11 });
    return b;
  },
  /** Tile placed / option selected: a tiny wooden tap. */
  tap() {
    const b = buffer(0.06);
    note(b, { at: 0, freq: midi(C5 + 19), dur: 0.05, gain: 0.25, decay: 60 });
    puff(b, { at: 0, dur: 0.02, gain: 0.25, lowpass: 0.5, seed: 3 });
    return b;
  },
  /** Button press: a soft pop. */
  pop() {
    const b = buffer(0.08);
    note(b, { at: 0, freq: midi(C5 + 12), dur: 0.07, gain: 0.3, decay: 40, glide: -0.3 });
    return b;
  },
  /** Several right in a row: a quick rising arpeggio (used sparingly — at 5, 10, 15…). */
  combo() {
    const b = buffer(0.5);
    [0, 4, 7, 12].forEach((n, i) => note(b, { at: i * 0.055, freq: midi(C5 + 7 + n), dur: 0.3, gain: 0.38, decay: 10, bell: true }));
    return room(b);
  },
  /** Lesson complete: a little fanfare and a held major chord. */
  complete() {
    const b = buffer(1.3);
    [0, 4, 7].forEach((n, i) => note(b, { at: i * 0.1, freq: midi(C5 + n), dur: 0.35, gain: 0.4, decay: 7 }));
    [0, 4, 7, 12].forEach((n) => note(b, { at: 0.32, freq: midi(C5 + 12 + n), dur: 0.95, gain: 0.28, decay: 3.5, bell: n === 12 }));
    return room(b, { mix: 0.22 });
  },
  /** Streak extended: a warm whoosh that lands on a chime. */
  streak() {
    const b = buffer(0.9);
    puff(b, { at: 0, dur: 0.35, gain: 0.3, lowpass: 0.08, seed: 7 });
    note(b, { at: 0.02, freq: midi(C5 - 5), dur: 0.35, gain: 0.25, decay: 5, glide: 1.0 });
    note(b, { at: 0.3, freq: midi(C5 + 19), dur: 0.55, gain: 0.45, decay: 5, bell: true });
    note(b, { at: 0.3, freq: midi(C5 + 12), dur: 0.55, gain: 0.3, decay: 5 });
    return room(b);
  },
  /** Level, section or badge: the biggest celebration — a rising major run with sparkle. */
  levelup() {
    const b = buffer(1.8);
    [0, 2, 4, 5, 7, 9, 11, 12].forEach((n, i) => note(b, { at: i * 0.06, freq: midi(C5 + n), dur: 0.25, gain: 0.3, decay: 10 }));
    [0, 4, 7, 12, 16].forEach((n) => note(b, { at: 0.5, freq: midi(C5 + n), dur: 1.25, gain: 0.25, decay: 2.6 }));
    [24, 28, 31, 36].forEach((n, i) => note(b, { at: 0.55 + i * 0.07, freq: midi(C5 + n), dur: 0.4, gain: 0.12, decay: 9, bell: true }));
    return room(b, { mix: 0.25 });
  },
  /** Gems earned: three quick glassy sparkles. */
  gem() {
    const b = buffer(0.55);
    [24, 28, 31].forEach((n, i) => note(b, { at: i * 0.07, freq: midi(C5 + n), dur: 0.3, gain: 0.3, decay: 12, bell: true }));
    return room(b);
  },
  /** Something new unlocked (story chapter, unit, shop item): "ta-da". */
  unlock() {
    const b = buffer(0.8);
    note(b, { at: 0, freq: midi(C5 + 7), dur: 0.16, gain: 0.4, decay: 12 });
    note(b, { at: 0.13, freq: midi(C5 + 12), dur: 0.6, gain: 0.45, decay: 4.5, bell: true });
    note(b, { at: 0.13, freq: midi(C5 + 4), dur: 0.6, gain: 0.25, decay: 4.5 });
    return room(b);
  },
  /** Word Garden: watering — a few bubbly drops falling in pitch. */
  water() {
    const b = buffer(0.6);
    [0, 0.09, 0.16, 0.26, 0.31].forEach((at, i) =>
      note(b, { at, freq: midi(C5 + 24 - i * 2), dur: 0.12, gain: 0.25, decay: 30, glide: -0.45 }),
    );
    puff(b, { at: 0, dur: 0.5, gain: 0.08, lowpass: 0.3, seed: 11 });
    return b;
  },
  /** Word Garden: a plant reaches a new stage (bloom). */
  bloom() {
    const b = buffer(0.9);
    [0, 7, 12, 16, 19].forEach((n, i) => note(b, { at: i * 0.045, freq: midi(C5 + 12 + n), dur: 0.5, gain: 0.22, decay: 6, bell: true }));
    return room(b, { mix: 0.24 });
  },
  /** Quest complete: a cheerful three-note motif. */
  quest() {
    const b = buffer(0.7);
    [
      [0, 7],
      [0.1, 11],
      [0.2, 14],
    ].forEach(([at, n]) => note(b, { at, freq: midi(C5 + n), dur: 0.4, gain: 0.38, decay: 7 }));
    note(b, { at: 0.2, freq: midi(C5 + 26), dur: 0.45, gain: 0.15, decay: 8, bell: true });
    return room(b);
  },
  /** The daily goal ring closes: a rising glide into a bright bell chord. */
  ring() {
    const b = buffer(0.75);
    glide(b, { at: 0, from: 600, to: 1200, dur: 0.25, gain: 0.25 });
    [0, 4, 7].forEach((n) => note(b, { at: 0.22, freq: midi(C5 + 12 + n), dur: 0.5, gain: 0.3, decay: 6, bell: true }));
    return room(b);
  },
  /** A passport stamp: a doira thump with its jingles. */
  stamp() {
    const b = buffer(0.42);
    drum(b, { at: 0, gain: 0.7 });
    bandNoise(b, { at: 0, dur: 0.03, gain: 0.3, low: 0.4, high: 0.5, seed: 21, decay: 90 });
    return b;
  },
  /** A story chapter unlocks: a dutar motif, two strings a fourth apart (D3 and G3). */
  chapter() {
    const b = buffer(1.35);
    const D3 = 146.83;
    const G3 = 196.0;
    const A3 = 220.0;
    [D3, G3, A3, G3, D3].forEach((f, i) => pluck(b, { at: i * 0.11, freq: f, dur: 1.2 - i * 0.1, gain: 0.55, seed: 31 + i }));
    pluck(b, { at: 0.55, freq: D3 * 2, dur: 0.8, gain: 0.25, seed: 41, brightness: 0.3 });
    return room(b, { mix: 0.16 });
  },
  /** A freeze kept the streak: three slow, cold bells and a puff of air. */
  freeze() {
    const b = buffer(0.85);
    [C5 + 24, C5 + 28, C5 + 23].forEach((n, i) => note(b, { at: i * 0.09, freq: midi(n), dur: 0.6, gain: 0.22, decay: 5, bell: true, attack: 0.03 }));
    bandNoise(b, { at: 0, dur: 0.6, gain: 0.12, low: 0.9, high: 0.7, seed: 51, env: 'swell' });
    return room(b, { mix: 0.25 });
  },
  /** A page turns (story "play all" advancing a line); played very quietly. */
  page() {
    const b = buffer(0.2);
    bandNoise(b, { at: 0, dur: 0.18, gain: 0.35, low: 0.2, high: 0.2, seed: 61, env: 'swell' });
    return b;
  },
  /** A friend's kudos: two soft claps. */
  kudos() {
    const b = buffer(0.32);
    bandNoise(b, { at: 0, dur: 0.012, gain: 0.5, low: 0.5, high: 0.4, seed: 71, decay: 200 });
    bandNoise(b, { at: 0.14, dur: 0.012, gain: 0.45, low: 0.5, high: 0.4, seed: 72, decay: 200 });
    return room(b, { mix: 0.12 });
  },
  /** League promotion: a rising marimba with a doira on the third note and a bell on top. */
  promote() {
    const b = buffer(1.05);
    [0, 4, 7].forEach((n, i) => note(b, { at: i * 0.12, freq: midi(C5 + n), dur: 0.35, gain: 0.4, decay: 9 }));
    drum(b, { at: 0.24, gain: 0.35 });
    note(b, { at: 0.36, freq: midi(C5 + 12), dur: 0.65, gain: 0.32, decay: 4.5, bell: true });
    return room(b);
  },
  /** The microphone starts listening. */
  mic_on() {
    const b = buffer(0.08);
    glide(b, { at: 0, from: 880, to: 1320, dur: 0.06, gain: 0.35 });
    return b;
  },
  /** The microphone stops. */
  mic_off() {
    const b = buffer(0.08);
    glide(b, { at: 0, from: 1320, to: 880, dur: 0.06, gain: 0.35 });
    return b;
  },
  /** A hint is revealed: one soft bell. */
  hint() {
    const b = buffer(0.42);
    note(b, { at: 0, freq: midi(C5 + 9), dur: 0.38, gain: 0.3, decay: 8, bell: true });
    return room(b);
  },
  /** Travelling to the next section of the path. */
  whoosh() {
    const b = buffer(0.38);
    const rnd = noise(81);
    const len = Math.floor(0.35 * RATE);
    let y = 0;
    for (let i = 0; i < len; i += 1) {
      const t = i / len;
      const cutoff = 0.03 + 0.4 * Math.sin(Math.PI * t); // the lowpass sweeps up, then down
      y += cutoff * (rnd() - y);
      b[i] += 0.5 * Math.sin(Math.PI * t) ** 2 * y;
    }
    return b;
  },
};

mkdirSync(OUT, { recursive: true });
let total = 0;
for (const [name, make] of Object.entries(SOUNDS)) {
  const bytes = wav(normalise(make()));
  writeFileSync(join(OUT, `${name}.wav`), bytes);
  total += bytes.length;
  console.log(`  ${name.padEnd(10)} ${(bytes.length / 1024).toFixed(1).padStart(6)} KB`);
}
console.log(`sfx: ${Object.keys(SOUNDS).length} sounds, ${(total / 1024).toFixed(0)} KB → assets/sfx/`);
