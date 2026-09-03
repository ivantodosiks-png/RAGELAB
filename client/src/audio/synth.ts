import { mulberry32 } from '@ragelab/shared';

/**
 * Every sound in RAGELAB is synthesised at runtime.
 *
 * That keeps the download at zero bytes of audio, makes each weapon trivially
 * re-tunable from its definition, and avoids licensing questions entirely. The
 * generators below are plain buffer maths - no oscillator graph - so they are
 * cheap enough to run once at startup and cache.
 */

export type SoundKey =
  | 'pistol'
  | 'smg'
  | 'rifle'
  | 'shotgun'
  | 'sniper'
  | 'reload_light'
  | 'reload_heavy'
  | 'reload_shell'
  | 'dryfire'
  | 'equip'
  | 'footstep_concrete'
  | 'footstep_metal'
  | 'footstep_wood'
  | 'footstep_dirt'
  | 'footstep_grass'
  | 'jump'
  | 'land'
  | 'impact_concrete'
  | 'impact_metal'
  | 'impact_wood'
  | 'impact_dirt'
  | 'impact_grass'
  | 'impact_glass'
  | 'impact_flesh'
  | 'explosion'
  | 'hitmarker'
  | 'headshot'
  | 'hurt'
  | 'death'
  | 'pickup'
  | 'door'
  | 'switch'
  | 'prop_break'
  | 'ui_click'
  | 'ui_hover'
  | 'ui_back'
  | 'killfeed'
  | 'ambience';

interface Envelope {
  attack: number;
  decay: number;
  sustain: number;
  release: number;
}

function applyEnvelope(data: Float32Array, sampleRate: number, env: Envelope): void {
  const n = data.length;
  const a = Math.max(1, Math.floor(env.attack * sampleRate));
  const d = Math.max(1, Math.floor(env.decay * sampleRate));
  const r = Math.max(1, Math.floor(env.release * sampleRate));
  const sustainStart = a + d;
  const releaseStart = Math.max(sustainStart, n - r);

  for (let i = 0; i < n; i++) {
    let gain: number;
    if (i < a) gain = i / a;
    else if (i < sustainStart) gain = 1 - (1 - env.sustain) * ((i - a) / d);
    else if (i < releaseStart) gain = env.sustain;
    else gain = env.sustain * (1 - (i - releaseStart) / Math.max(1, n - releaseStart));
    data[i]! *= gain;
  }
}

/** One-pole low pass; `cutoff` is normalized 0..1. */
function lowpass(data: Float32Array, cutoff: number): void {
  let last = 0;
  const a = Math.min(1, Math.max(0.001, cutoff));
  for (let i = 0; i < data.length; i++) {
    last += a * (data[i]! - last);
    data[i] = last;
  }
}

function highpass(data: Float32Array, cutoff: number): void {
  let last = 0;
  let lastOut = 0;
  const a = Math.min(0.999, Math.max(0.001, 1 - cutoff));
  for (let i = 0; i < data.length; i++) {
    const input = data[i]!;
    lastOut = a * (lastOut + input - last);
    last = input;
    data[i] = lastOut;
  }
}

function normalize(data: Float32Array, peak = 0.92): void {
  let max = 0;
  for (let i = 0; i < data.length; i++) max = Math.max(max, Math.abs(data[i]!));
  if (max < 1e-6) return;
  const scale = peak / max;
  for (let i = 0; i < data.length; i++) data[i]! *= scale;
}

/** Soft clipper: gives the gunshots weight without harsh digital clipping. */
function saturate(data: Float32Array, drive: number): void {
  for (let i = 0; i < data.length; i++) {
    data[i] = Math.tanh(data[i]! * drive) / Math.tanh(drive);
  }
}

interface GunParams {
  duration: number;
  bodyFreq: number;
  bodyDecay: number;
  noiseAmount: number;
  crackAmount: number;
  tailAmount: number;
  drive: number;
  seed: number;
}

function renderGunshot(sampleRate: number, p: GunParams): Float32Array {
  const n = Math.floor(p.duration * sampleRate);
  const data = new Float32Array(n);
  const rand = mulberry32(p.seed);

  // Body: a fast downward pitch sweep, the "thump".
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const freq = p.bodyFreq * Math.exp(-t * p.bodyDecay);
    phase += (freq * 2 * Math.PI) / sampleRate;
    data[i] = Math.sin(phase) * Math.exp(-t * p.bodyDecay * 0.75);
  }

  // Crack: short burst of bright noise at the very start.
  const crackLen = Math.floor(sampleRate * 0.012);
  for (let i = 0; i < crackLen && i < n; i++) {
    const t = i / crackLen;
    data[i]! += (rand() * 2 - 1) * p.crackAmount * (1 - t) ** 2;
  }

  // Blast noise, band limited so it reads as air rather than hiss.
  const noise = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    noise[i] = (rand() * 2 - 1) * Math.exp(-t * 26) * p.noiseAmount;
  }
  lowpass(noise, 0.35);
  for (let i = 0; i < n; i++) data[i]! += noise[i]!;

  // Tail: room reflections, longer and darker.
  const tail = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    tail[i] = (rand() * 2 - 1) * Math.exp(-t * 5.5) * p.tailAmount;
  }
  lowpass(tail, 0.08);
  for (let i = 0; i < n; i++) data[i]! += tail[i]!;

  saturate(data, p.drive);
  applyEnvelope(data, sampleRate, {
    attack: 0.0004,
    decay: 0.02,
    sustain: 0.55,
    release: p.duration * 0.6,
  });
  normalize(data);
  return data;
}

function renderNoiseBurst(
  sampleRate: number,
  duration: number,
  decay: number,
  cutoff: number,
  seed: number,
  highpassCutoff = 0,
): Float32Array {
  const n = Math.floor(duration * sampleRate);
  const data = new Float32Array(n);
  const rand = mulberry32(seed);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    data[i] = (rand() * 2 - 1) * Math.exp(-t * decay);
  }
  lowpass(data, cutoff);
  if (highpassCutoff > 0) highpass(data, highpassCutoff);
  normalize(data, 0.85);
  return data;
}

function renderTone(
  sampleRate: number,
  duration: number,
  freqStart: number,
  freqEnd: number,
  decay: number,
  harmonics = 1,
): Float32Array {
  const n = Math.floor(duration * sampleRate);
  const data = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const k = t / duration;
    const freq = freqStart + (freqEnd - freqStart) * k;
    phase += (freq * 2 * Math.PI) / sampleRate;
    let sample = Math.sin(phase);
    for (let h = 2; h <= harmonics; h++) sample += Math.sin(phase * h) / (h * 1.8);
    data[i] = sample * Math.exp(-t * decay);
  }
  normalize(data, 0.7);
  return data;
}

/** Layer several clicks to build a mechanical sequence (reloads, bolts). */
function renderMechanical(
  sampleRate: number,
  duration: number,
  clicks: Array<{ at: number; freq: number; decay: number; gain: number }>,
  seed: number,
): Float32Array {
  const n = Math.floor(duration * sampleRate);
  const data = new Float32Array(n);
  const rand = mulberry32(seed);

  for (const click of clicks) {
    const start = Math.floor(click.at * sampleRate);
    let phase = 0;
    for (let i = start; i < n; i++) {
      const t = (i - start) / sampleRate;
      const env = Math.exp(-t * click.decay);
      if (env < 0.0005) break;
      phase += (click.freq * 2 * Math.PI) / sampleRate;
      const body = Math.sin(phase) * 0.55;
      const noise = (rand() * 2 - 1) * 0.45;
      data[i]! += (body + noise) * env * click.gain;
    }
  }
  lowpass(data, 0.5);
  normalize(data, 0.8);
  return data;
}

function renderExplosion(sampleRate: number, seed: number): Float32Array {
  const duration = 1.9;
  const n = Math.floor(duration * sampleRate);
  const data = new Float32Array(n);
  const rand = mulberry32(seed);

  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const freq = 78 * Math.exp(-t * 3.4) + 24;
    phase += (freq * 2 * Math.PI) / sampleRate;
    data[i] = Math.sin(phase) * Math.exp(-t * 2.6) * 1.2;
  }

  const rumble = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    rumble[i] = (rand() * 2 - 1) * Math.exp(-t * 1.9);
  }
  lowpass(rumble, 0.045);
  for (let i = 0; i < n; i++) data[i]! += rumble[i]! * 1.4;

  const crack = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    crack[i] = (rand() * 2 - 1) * Math.exp(-t * 30);
  }
  lowpass(crack, 0.6);
  for (let i = 0; i < n; i++) data[i]! += crack[i]! * 0.8;

  saturate(data, 2.2);
  normalize(data);
  return data;
}

function renderAmbience(sampleRate: number, seed: number): Float32Array {
  // Four seconds of wind, loopable via crossfade at the edges.
  const duration = 4;
  const n = Math.floor(duration * sampleRate);
  const data = new Float32Array(n);
  const rand = mulberry32(seed);
  for (let i = 0; i < n; i++) data[i] = rand() * 2 - 1;
  lowpass(data, 0.02);
  lowpass(data, 0.02);

  // Slow amplitude drift so it never sounds like static.
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    data[i]! *= 0.55 + 0.45 * Math.sin(t * 0.7) * Math.sin(t * 0.23 + 1.1);
  }

  // Crossfade the last 0.5 s into the first so looping is seamless.
  const fade = Math.floor(sampleRate * 0.5);
  for (let i = 0; i < fade; i++) {
    const k = i / fade;
    const tail = data[n - fade + i]!;
    data[i] = data[i]! * k + tail * (1 - k);
  }
  normalize(data, 0.5);
  return data.subarray(0, n - fade) as Float32Array;
}

const GUN_PRESETS: Record<string, GunParams> = {
  pistol: {
    duration: 0.42,
    bodyFreq: 240,
    bodyDecay: 34,
    noiseAmount: 0.85,
    crackAmount: 0.9,
    tailAmount: 0.22,
    drive: 2.6,
    seed: 0x51a7,
  },
  smg: {
    duration: 0.3,
    bodyFreq: 300,
    bodyDecay: 46,
    noiseAmount: 0.7,
    crackAmount: 0.95,
    tailAmount: 0.16,
    drive: 2.4,
    seed: 0x77c3,
  },
  rifle: {
    duration: 0.55,
    bodyFreq: 190,
    bodyDecay: 26,
    noiseAmount: 0.95,
    crackAmount: 1.0,
    tailAmount: 0.34,
    drive: 3.0,
    seed: 0x1f0d,
  },
  shotgun: {
    duration: 0.85,
    bodyFreq: 120,
    bodyDecay: 15,
    noiseAmount: 1.25,
    crackAmount: 0.8,
    tailAmount: 0.55,
    drive: 3.4,
    seed: 0x9b21,
  },
  sniper: {
    duration: 1.25,
    bodyFreq: 132,
    bodyDecay: 12,
    noiseAmount: 1.1,
    crackAmount: 1.2,
    tailAmount: 0.75,
    drive: 3.6,
    seed: 0x3e45,
  },
};

/** Build the full sound bank. Runs once, off the render path. */
export function synthesizeBank(sampleRate: number): Map<SoundKey, Float32Array> {
  const bank = new Map<SoundKey, Float32Array>();

  for (const [key, params] of Object.entries(GUN_PRESETS)) {
    bank.set(key as SoundKey, renderGunshot(sampleRate, params));
  }

  bank.set(
    'reload_light',
    renderMechanical(
      sampleRate,
      1.3,
      [
        { at: 0.0, freq: 520, decay: 55, gain: 0.7 },
        { at: 0.22, freq: 300, decay: 38, gain: 0.85 },
        { at: 0.72, freq: 420, decay: 45, gain: 0.9 },
        { at: 1.02, freq: 700, decay: 70, gain: 0.6 },
      ],
      0x2b71,
    ),
  );
  bank.set(
    'reload_heavy',
    renderMechanical(
      sampleRate,
      2.0,
      [
        { at: 0.0, freq: 340, decay: 40, gain: 0.8 },
        { at: 0.35, freq: 210, decay: 26, gain: 1.0 },
        { at: 1.1, freq: 280, decay: 32, gain: 0.95 },
        { at: 1.55, freq: 480, decay: 55, gain: 0.7 },
      ],
      0x6cf2,
    ),
  );
  bank.set(
    'reload_shell',
    renderMechanical(
      sampleRate,
      0.6,
      [
        { at: 0.0, freq: 620, decay: 60, gain: 0.75 },
        { at: 0.18, freq: 380, decay: 42, gain: 0.9 },
      ],
      0x88a1,
    ),
  );
  bank.set(
    'dryfire',
    renderMechanical(sampleRate, 0.16, [{ at: 0, freq: 900, decay: 110, gain: 0.8 }], 0x1234),
  );
  bank.set(
    'equip',
    renderMechanical(
      sampleRate,
      0.4,
      [
        { at: 0.0, freq: 260, decay: 40, gain: 0.7 },
        { at: 0.14, freq: 520, decay: 60, gain: 0.5 },
      ],
      0x4321,
    ),
  );

  bank.set('footstep_concrete', renderNoiseBurst(sampleRate, 0.16, 42, 0.34, 0x1101, 0.05));
  bank.set('footstep_metal', renderNoiseBurst(sampleRate, 0.22, 34, 0.72, 0x1102, 0.12));
  bank.set('footstep_wood', renderNoiseBurst(sampleRate, 0.18, 40, 0.24, 0x1103, 0.04));
  bank.set('footstep_dirt', renderNoiseBurst(sampleRate, 0.2, 38, 0.14, 0x1104));
  bank.set('footstep_grass', renderNoiseBurst(sampleRate, 0.22, 34, 0.5, 0x1105, 0.2));

  bank.set('jump', renderNoiseBurst(sampleRate, 0.2, 30, 0.2, 0x1201));
  bank.set('land', renderNoiseBurst(sampleRate, 0.35, 18, 0.12, 0x1202));

  bank.set('impact_concrete', renderNoiseBurst(sampleRate, 0.24, 40, 0.4, 0x1301, 0.1));
  bank.set('impact_metal', mixBuffers(
    renderNoiseBurst(sampleRate, 0.3, 30, 0.85, 0x1302, 0.2),
    renderTone(sampleRate, 0.3, 2400, 1700, 26, 3),
    0.6,
  ));
  bank.set('impact_wood', renderNoiseBurst(sampleRate, 0.22, 44, 0.22, 0x1303));
  bank.set('impact_dirt', renderNoiseBurst(sampleRate, 0.26, 36, 0.1, 0x1304));
  bank.set('impact_grass', renderNoiseBurst(sampleRate, 0.24, 38, 0.45, 0x1305, 0.25));
  bank.set('impact_glass', mixBuffers(
    renderNoiseBurst(sampleRate, 0.5, 16, 0.95, 0x1306, 0.4),
    renderTone(sampleRate, 0.5, 4200, 2600, 12, 4),
    0.55,
  ));
  bank.set('impact_flesh', renderNoiseBurst(sampleRate, 0.18, 52, 0.08, 0x1307));

  bank.set('explosion', renderExplosion(sampleRate, 0x2ee1));
  bank.set('prop_break', mixBuffers(
    renderNoiseBurst(sampleRate, 0.6, 14, 0.6, 0x2ee2, 0.15),
    renderTone(sampleRate, 0.6, 320, 90, 9, 3),
    0.5,
  ));

  bank.set('hitmarker', renderTone(sampleRate, 0.07, 1500, 1900, 44));
  bank.set('headshot', renderTone(sampleRate, 0.13, 1900, 2600, 30, 2));
  bank.set('hurt', mixBuffers(
    renderNoiseBurst(sampleRate, 0.3, 22, 0.16, 0x3001),
    renderTone(sampleRate, 0.3, 180, 110, 12),
    0.5,
  ));
  bank.set('death', renderTone(sampleRate, 1.1, 320, 70, 4, 3));
  bank.set('pickup', renderTone(sampleRate, 0.22, 780, 1320, 12, 2));
  bank.set('door', mixBuffers(
    renderNoiseBurst(sampleRate, 0.9, 6, 0.28, 0x3101),
    renderTone(sampleRate, 0.9, 120, 90, 3),
    0.45,
  ));
  bank.set('switch', renderMechanical(
    sampleRate,
    0.2,
    [{ at: 0, freq: 780, decay: 90, gain: 0.85 }],
    0x3102,
  ));
  bank.set('killfeed', renderTone(sampleRate, 0.18, 620, 940, 16, 2));

  bank.set('ui_click', renderTone(sampleRate, 0.08, 900, 1200, 40, 2));
  bank.set('ui_hover', renderTone(sampleRate, 0.05, 1400, 1500, 60));
  bank.set('ui_back', renderTone(sampleRate, 0.11, 700, 420, 26, 2));

  bank.set('ambience', renderAmbience(sampleRate, 0x4001));

  return bank;
}

function mixBuffers(a: Float32Array, b: Float32Array, ratio: number): Float32Array {
  const n = Math.max(a.length, b.length);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = (a[i] ?? 0) * (1 - ratio) + (b[i] ?? 0) * ratio;
  }
  normalize(out);
  return out;
}
