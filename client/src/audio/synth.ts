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
  | 'pistol_distant'
  | 'pistol_reload'
  | 'smg'
  | 'rifle'
  | 'rifle_distant'
  | 'shotgun'
  | 'shotgun_distant'
  | 'sniper'
  | 'magnum'
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
  | 'footstep_1'
  | 'footstep_2'
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

  let phase = 0;
  let phase2 = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const freq = p.bodyFreq * Math.exp(-t * p.bodyDecay);
    phase += (freq * 2 * Math.PI) / sampleRate;
    phase2 += ((freq * 1.53 + 40) * 2 * Math.PI) / sampleRate;
    data[i] =
      Math.sin(phase) * Math.exp(-t * p.bodyDecay * 0.7) +
      Math.sin(phase2) * 0.35 * Math.exp(-t * p.bodyDecay * 1.1);
  }

  const crackLen = Math.floor(sampleRate * 0.008);
  for (let i = 0; i < crackLen && i < n; i++) {
    const t = i / crackLen;
    data[i]! += (rand() * 2 - 1) * p.crackAmount * (1 - t) ** 1.6 * 1.35;
  }

  const noise = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    noise[i] = (rand() * 2 - 1) * Math.exp(-t * 22) * p.noiseAmount;
  }
  highpass(noise, 0.12);
  lowpass(noise, 0.42);
  for (let i = 0; i < n; i++) data[i]! += noise[i]!;

  const mechLen = Math.floor(sampleRate * 0.035);
  let mechPhase = 0;
  for (let i = 0; i < mechLen && i < n; i++) {
    const t = i / sampleRate;
    mechPhase += (2100 * 2 * Math.PI) / sampleRate;
    data[i]! += Math.sin(mechPhase) * Math.exp(-t * 90) * 0.28;
    data[i]! += (rand() * 2 - 1) * Math.exp(-t * 70) * 0.22;
  }

  const tail = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    tail[i] = (rand() * 2 - 1) * Math.exp(-t * 4.8) * p.tailAmount;
  }
  lowpass(tail, 0.07);
  for (let i = 0; i < n; i++) data[i]! += tail[i]!;

  saturate(data, p.drive);
  applyEnvelope(data, sampleRate, {
    attack: 0.00025,
    decay: 0.016,
    sustain: 0.5,
    release: p.duration * 0.55,
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

type FootSurface = 'concrete' | 'metal' | 'wood' | 'dirt' | 'grass';

/** Layered heel + grit + surface character. Playback-rate variation keeps each step unique. */
function renderFootstep(sampleRate: number, surface: FootSurface, seed: number): Float32Array {
  const duration = surface === 'metal' ? 0.34 : 0.28;
  const n = Math.floor(duration * sampleRate);
  const data = new Float32Array(n);
  const rand = mulberry32(seed);

  let heelFreq = 72;
  let heelDecay = 32;
  let gritCutoff = 0.26;
  let gritGain = 0.62;
  let soleGain = 0.4;
  let toeDelay = 0.018;
  if (surface === 'metal') {
    heelFreq = 88;
    heelDecay = 26;
    gritCutoff = 0.5;
    gritGain = 0.48;
    soleGain = 0.72;
    toeDelay = 0.014;
  } else if (surface === 'wood') {
    heelFreq = 118;
    heelDecay = 24;
    gritCutoff = 0.2;
    gritGain = 0.5;
    soleGain = 0.55;
    toeDelay = 0.016;
  } else if (surface === 'dirt') {
    heelFreq = 58;
    heelDecay = 18;
    gritCutoff = 0.1;
    gritGain = 0.95;
    soleGain = 0.12;
    toeDelay = 0.022;
  } else if (surface === 'grass') {
    heelFreq = 64;
    heelDecay = 20;
    gritCutoff = 0.38;
    gritGain = 1.05;
    soleGain = 0.1;
    toeDelay = 0.024;
  }

  let heelPhase = 0;
  const toeStart = Math.floor(toeDelay * sampleRate);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    heelPhase += ((heelFreq * Math.exp(-t * 7) + 28) * 2 * Math.PI) / sampleRate;
    data[i] = Math.sin(heelPhase) * Math.exp(-t * heelDecay) * 1.25;
  }

  let toePhase = 0;
  for (let i = toeStart; i < n; i++) {
    const t = (i - toeStart) / sampleRate;
    toePhase += ((heelFreq * 1.35 * Math.exp(-t * 9) + 40) * 2 * Math.PI) / sampleRate;
    data[i]! += Math.sin(toePhase) * Math.exp(-t * (heelDecay + 6)) * 0.7;
  }

  const grit = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const heelScuff = t < 0.03 ? 1 : Math.exp(-(t - 0.03) * 28);
    const toeScuff = t > toeDelay && t < toeDelay + 0.05 ? 0.85 : 0;
    grit[i] = (rand() * 2 - 1) * (heelScuff * 0.7 + toeScuff) * gritGain;
  }
  lowpass(grit, gritCutoff);
  for (let i = 0; i < n; i++) data[i]! += grit[i]!;

  const clickLen = Math.floor(sampleRate * 0.008);
  for (let i = 0; i < clickLen && i < n; i++) {
    data[i]! += (rand() * 2 - 1) * soleGain * (1 - i / clickLen);
  }
  for (let i = 0; i < clickLen && toeStart + i < n; i++) {
    data[toeStart + i]! += (rand() * 2 - 1) * soleGain * 0.55 * (1 - i / clickLen);
  }

  if (surface === 'metal') {
    let ring = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sampleRate;
      ring += ((1420 + 220 * Math.sin(t * 40)) * 2 * Math.PI) / sampleRate;
      data[i]! += Math.sin(ring) * Math.exp(-t * 14) * 0.22;
    }
  } else if (surface === 'wood') {
    let ring = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sampleRate;
      ring += (640 * 2 * Math.PI) / sampleRate;
      data[i]! += Math.sin(ring) * Math.exp(-t * 22) * 0.16;
    }
  } else if (surface === 'grass') {
    for (let i = 0; i < n; i++) {
      const t = i / sampleRate;
      data[i]! += (rand() * 2 - 1) * Math.exp(-t * 18) * 0.2 * Math.sin(t * 80);
    }
  }

  saturate(data, 1.28);
  normalize(data, 0.9);
  return data;
}

function renderLand(sampleRate: number, seed: number): Float32Array {
  const n = Math.floor(0.38 * sampleRate);
  const data = new Float32Array(n);
  const rand = mulberry32(seed);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    phase += ((70 * Math.exp(-t * 6) + 28) * 2 * Math.PI) / sampleRate;
    data[i] = Math.sin(phase) * Math.exp(-t * 14);
    data[i]! += (rand() * 2 - 1) * Math.exp(-t * 16) * 0.55;
  }
  lowpass(data, 0.22);
  normalize(data, 0.9);
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
    duration: 0.48,
    bodyFreq: 210,
    bodyDecay: 30,
    noiseAmount: 0.95,
    crackAmount: 1.15,
    tailAmount: 0.2,
    drive: 2.8,
    seed: 0x51a7,
  },
  smg: {
    duration: 0.28,
    bodyFreq: 280,
    bodyDecay: 42,
    noiseAmount: 0.78,
    crackAmount: 1.05,
    tailAmount: 0.12,
    drive: 2.5,
    seed: 0x77c3,
  },
  rifle: {
    duration: 0.62,
    bodyFreq: 168,
    bodyDecay: 22,
    noiseAmount: 1.05,
    crackAmount: 1.2,
    tailAmount: 0.38,
    drive: 3.15,
    seed: 0x1f0d,
  },
  shotgun: {
    duration: 0.95,
    bodyFreq: 96,
    bodyDecay: 12,
    noiseAmount: 1.4,
    crackAmount: 0.95,
    tailAmount: 0.62,
    drive: 3.6,
    seed: 0x9b21,
  },
  sniper: {
    duration: 1.35,
    bodyFreq: 108,
    bodyDecay: 9.5,
    noiseAmount: 1.2,
    crackAmount: 1.35,
    tailAmount: 0.82,
    drive: 3.8,
    seed: 0x3e45,
  },
  magnum: {
    duration: 1.15,
    bodyFreq: 88,
    bodyDecay: 10,
    noiseAmount: 1.22,
    crackAmount: 1.3,
    tailAmount: 0.58,
    drive: 3.7,
    seed: 0x50ae,
  },
};

/** Build the full sound bank. Runs once, off the render path. */
export function synthesizeBank(sampleRate: number): Map<SoundKey, Float32Array> {
  const bank = new Map<SoundKey, Float32Array>();

  for (const [key, params] of Object.entries(GUN_PRESETS)) {
    bank.set(key as SoundKey, renderGunshot(sampleRate, params));
  }
  bank.set('pistol_distant', bank.get('pistol')!);
  bank.set('rifle_distant', bank.get('rifle')!);
  bank.set('shotgun_distant', bank.get('shotgun')!);

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
  bank.set('pistol_reload', bank.get('reload_light')!);
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
      0.32,
      [
        { at: 0.0, freq: 140, decay: 28, gain: 0.55 },
        { at: 0.035, freq: 980, decay: 90, gain: 0.85 },
        { at: 0.09, freq: 420, decay: 48, gain: 0.7 },
        { at: 0.16, freq: 1550, decay: 120, gain: 0.4 },
      ],
      0x7a3c,
    ),
  );

  bank.set('footstep_concrete', renderFootstep(sampleRate, 'concrete', 0x1101));
  bank.set('footstep_metal', renderFootstep(sampleRate, 'metal', 0x1102));
  bank.set('footstep_wood', renderFootstep(sampleRate, 'wood', 0x1103));
  bank.set('footstep_dirt', renderFootstep(sampleRate, 'dirt', 0x1104));
  bank.set('footstep_grass', renderFootstep(sampleRate, 'grass', 0x1105));
  bank.set('footstep_1', renderFootstep(sampleRate, 'concrete', 0x1106));
  bank.set('footstep_2', renderFootstep(sampleRate, 'concrete', 0x1107));

  bank.set('jump', renderFootstep(sampleRate, 'dirt', 0x1201));
  bank.set('land', renderLand(sampleRate, 0x1202));

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
