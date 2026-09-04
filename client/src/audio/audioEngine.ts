import type { AudioSettings, SurfaceId, Vec3 } from '@ragelab/shared';
import { synthesizeBank, type SoundKey } from './synth';
import { DISTANT_FIRE_RANGE, DISTANT_FOR, RECORDED_SAMPLES } from './samples';

export interface PlayOptions {
  /** World position; omit for a 2D (UI / self) sound. */
  position?: Vec3;
  volume?: number;
  /** Playback rate; also shifts pitch. */
  rate?: number;
  /** Random pitch variation, +-this fraction. */
  variation?: number;
  maxDistance?: number;
  bus?: BusName;
  loop?: boolean;
}

export type BusName = 'effects' | 'music' | 'ui' | 'voice';

interface ActiveLoop {
  source: AudioBufferSourceNode;
  gain: GainNode;
}

const MAX_CONCURRENT = 48;

/**
 * Web Audio front end.
 *
 * All buffers are synthesised on first use (see synth.ts) and cached. Spatial
 * sounds go through a PannerNode with an inverse distance model, everything
 * else goes straight to its bus. Sources are fire-and-forget: the browser
 * reclaims them on `ended`, and we cap concurrency so a shotgun volley in a
 * crowded room cannot stall the audio thread.
 */
export class AudioEngine {
  private context: AudioContext | null = null;
  private readonly buffers = new Map<SoundKey, AudioBuffer>();
  private raw: Map<SoundKey, Float32Array> | null = null;

  private masterGain!: GainNode;
  private readonly busGains = new Map<BusName, GainNode>();
  private compressor!: DynamicsCompressorNode;

  private settings: AudioSettings;
  private activeCount = 0;
  private ambienceLoop: ActiveLoop | null = null;
  private muted = false;

  /** Last positions, so we can compute the listener velocity for doppler. */
  private readonly lastListenerPos = { x: 0, y: 0, z: 0 };

  constructor(settings: AudioSettings) {
    this.settings = settings;
  }

  get isReady(): boolean {
    return this.context !== null && this.context.state === 'running';
  }

  /**
   * Must be called from a user gesture. Building the bank takes a few hundred
   * milliseconds, so it happens once here rather than on the first gunshot.
   */
  async resume(): Promise<void> {
    if (!this.context) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.context = new Ctor({ latencyHint: 'interactive' });
      this.buildGraph();
      this.raw = synthesizeBank(this.context.sampleRate);
      await this.loadRecordedSamples();
    }
    if (this.context.state === 'suspended') await this.context.resume();
  }

  private async loadRecordedSamples(): Promise<void> {
    const ctx = this.context;
    if (!ctx) return;
    for (const [key, url] of Object.entries(RECORDED_SAMPLES)) {
      if (!url) continue;
      try {
        const response = await fetch(url);
        if (!response.ok) continue;
        const bytes = await response.arrayBuffer();
        const decoded = await ctx.decodeAudioData(bytes.slice(0));
        this.buffers.set(key as SoundKey, trimLeadingSilence(ctx, decoded));
      } catch (err) {
        console.warn(`[audio] recorded sample "${key}" failed, using synth`, err);
      }
    }
  }

  private buildGraph(): void {
    const ctx = this.context!;

    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -8;
    this.compressor.knee.value = 18;
    this.compressor.ratio.value = 4.5;
    this.compressor.attack.value = 0.003;
    this.compressor.release.value = 0.18;

    this.masterGain = ctx.createGain();
    this.compressor.connect(this.masterGain);
    this.masterGain.connect(ctx.destination);

    for (const bus of ['effects', 'music', 'ui', 'voice'] as BusName[]) {
      const gain = ctx.createGain();
      gain.connect(this.compressor);
      this.busGains.set(bus, gain);
    }

    const listener = ctx.listener;
    if (listener.forwardX) {
      listener.forwardX.value = 0;
      listener.forwardY.value = 0;
      listener.forwardZ.value = -1;
      listener.upX.value = 0;
      listener.upY.value = 1;
      listener.upZ.value = 0;
    }

    this.applySettings(this.settings);
  }

  applySettings(settings: AudioSettings): void {
    this.settings = settings;
    if (!this.context) return;
    const master = this.muted ? 0 : settings.master;
    this.masterGain.gain.value = master;
    this.busGains.get('effects')!.gain.value = settings.effects;
    this.busGains.get('music')!.gain.value = settings.music;
    this.busGains.get('ui')!.gain.value = settings.ui;
    this.busGains.get('voice')!.gain.value = settings.voice;

    if (settings.ambience > 0) this.startAmbience();
    else this.stopAmbience();
    if (this.ambienceLoop) this.ambienceLoop.gain.gain.value = settings.ambience * 0.5;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.context) this.masterGain.gain.value = muted ? 0 : this.settings.master;
  }

  private buffer(key: SoundKey): AudioBuffer | null {
    const ctx = this.context;
    if (!ctx || !this.raw) return null;
    const cached = this.buffers.get(key);
    if (cached) return cached;
    const data = this.raw.get(key);
    if (!data) return null;
    const buffer = ctx.createBuffer(1, data.length, ctx.sampleRate);
    buffer.getChannelData(0).set(data);
    this.buffers.set(key, buffer);
    return buffer;
  }

  /** Move the listener; call once per frame with the camera transform. */
  updateListener(position: Vec3, forward: Vec3, up: Vec3, dtSec: number): void {
    const ctx = this.context;
    if (!ctx) return;
    const listener = ctx.listener;
    const t = ctx.currentTime;

    if (listener.positionX) {
      listener.positionX.setTargetAtTime(position.x, t, 0.01);
      listener.positionY.setTargetAtTime(position.y, t, 0.01);
      listener.positionZ.setTargetAtTime(position.z, t, 0.01);
      listener.forwardX.setTargetAtTime(forward.x, t, 0.01);
      listener.forwardY.setTargetAtTime(forward.y, t, 0.01);
      listener.forwardZ.setTargetAtTime(forward.z, t, 0.01);
      listener.upX.setTargetAtTime(up.x, t, 0.01);
      listener.upY.setTargetAtTime(up.y, t, 0.01);
      listener.upZ.setTargetAtTime(up.z, t, 0.01);
    } else {
      // Safari still uses the deprecated API.
      listener.setPosition?.(position.x, position.y, position.z);
      listener.setOrientation?.(forward.x, forward.y, forward.z, up.x, up.y, up.z);
    }

    void dtSec;
    this.lastListenerPos.x = position.x;
    this.lastListenerPos.y = position.y;
    this.lastListenerPos.z = position.z;
  }

  play(key: SoundKey, options: PlayOptions = {}): void {
    const ctx = this.context;
    if (!ctx || ctx.state !== 'running') return;
    if (this.activeCount >= MAX_CONCURRENT) return;
    const buffer = this.buffer(key);
    if (!buffer) return;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const variation = options.variation ?? 0;
    const rate = (options.rate ?? 1) * (1 + (Math.random() * 2 - 1) * variation);
    source.playbackRate.value = Math.max(0.05, rate);
    source.loop = options.loop ?? false;

    const gain = ctx.createGain();
    gain.gain.value = options.volume ?? 1;

    const bus = this.busGains.get(options.bus ?? 'effects')!;

    if (options.position) {
      const panner = ctx.createPanner();
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'inverse';
      panner.refDistance = 2.5;
      panner.maxDistance = options.maxDistance ?? 120;
      panner.rolloffFactor = 1.1;
      if (panner.positionX) {
        panner.positionX.value = options.position.x;
        panner.positionY.value = options.position.y;
        panner.positionZ.value = options.position.z;
      } else {
        panner.setPosition?.(options.position.x, options.position.y, options.position.z);
      }
      source.connect(gain).connect(panner).connect(bus);
    } else {
      source.connect(gain).connect(bus);
    }

    this.activeCount += 1;
    source.onended = () => {
      this.activeCount -= 1;
      source.disconnect();
      gain.disconnect();
    };
    source.start();
  }

  /** Distance-attenuated one-shot helper used by the game event handler. */
  playAt(key: SoundKey, position: Vec3, volume = 1, maxDistance = 120, variation = 0.06): void {
    const dx = position.x - this.lastListenerPos.x;
    const dy = position.y - this.lastListenerPos.y;
    const dz = position.z - this.lastListenerPos.z;
    const dist = Math.hypot(dx, dy, dz);
    const distant = DISTANT_FOR[key];
    const use = distant && dist >= DISTANT_FIRE_RANGE && this.hasBuffer(distant) ? distant : key;
    this.play(use, { position, volume, maxDistance, variation: distant && use === distant ? 0.01 : variation });
  }

  private hasBuffer(key: SoundKey): boolean {
    return this.buffers.has(key) || (this.raw?.has(key) ?? false);
  }

  playUi(key: SoundKey, volume = 0.6): void {
    this.play(key, { bus: 'ui', volume });
  }

  startAmbience(): void {
    const ctx = this.context;
    if (!ctx || this.ambienceLoop) return;
    const buffer = this.buffer('ambience');
    if (!buffer) return;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const gain = ctx.createGain();
    gain.gain.value = this.settings.ambience * 0.5;
    source.connect(gain).connect(this.busGains.get('music')!);
    source.start();
    this.ambienceLoop = { source, gain };
  }

  stopAmbience(): void {
    if (!this.ambienceLoop) return;
    try {
      this.ambienceLoop.source.stop();
    } catch {
      // Already stopped.
    }
    this.ambienceLoop.source.disconnect();
    this.ambienceLoop.gain.disconnect();
    this.ambienceLoop = null;
  }

  dispose(): void {
    this.stopAmbience();
    void this.context?.close();
    this.context = null;
    this.buffers.clear();
    this.raw = null;
  }
}

const IMPACT_BY_SURFACE: Record<SurfaceId, SoundKey> = {
  concrete: 'impact_concrete',
  metal: 'impact_metal',
  wood: 'impact_wood',
  sand: 'impact_dirt',
  glass: 'impact_glass',
  rubber: 'impact_dirt',
  grass: 'impact_grass',
};

let footstepIndex = 0;

export function footstepSound(_surface?: SurfaceId): SoundKey {
  const key = footstepIndex % 2 === 0 ? 'footstep_1' : 'footstep_2';
  footstepIndex += 1;
  return key;
}

export function impactSound(surface: SurfaceId): SoundKey {
  return IMPACT_BY_SURFACE[surface] ?? 'impact_concrete';
}

/** Drop encoder padding so the recorded M4 crack lands on the trigger frame. */
function trimLeadingSilence(ctx: AudioContext, buffer: AudioBuffer, threshold = 0.01): AudioBuffer {
  const channels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  let start = 0;
  const primary = buffer.getChannelData(0);
  while (start < primary.length && Math.abs(primary[start]!) < threshold) start += 1;
  start = Math.max(0, start - Math.floor(sampleRate * 0.002));
  if (start < 32) return buffer;
  const length = primary.length - start;
  if (length < sampleRate * 0.04) return buffer;
  const trimmed = ctx.createBuffer(channels, length, sampleRate);
  for (let c = 0; c < channels; c++) {
    trimmed.getChannelData(c).set(buffer.getChannelData(c).subarray(start));
  }
  return trimmed;
}
