import { QualityLevel, type UserSettings } from '../types/profile';

/** Actions that can be rebound. The value is the default binding. */
export const DEFAULT_BINDINGS: Record<string, string> = {
  forward: 'KeyW',
  back: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  jump: 'Space',
  sprint: 'ShiftLeft',
  crouch: 'KeyC',
  fire: 'Mouse0',
  aim: 'Mouse2',
  reload: 'KeyR',
  interact: 'KeyE',
  throwProp: 'Mouse0',
  dropProp: 'KeyG',
  weapon1: 'Digit1',
  weapon2: 'Digit2',
  weapon3: 'Digit3',
  weapon4: 'Digit4',
  weapon5: 'Digit5',
  nextWeapon: 'WheelUp',
  prevWeapon: 'WheelDown',
  scoreboard: 'Tab',
  chat: 'KeyT',
  menu: 'Escape',
  debug: 'F3',
  sandbox: 'KeyB',
};

export const ACTION_LABELS: Record<string, string> = {
  forward: 'Move forward',
  back: 'Move back',
  left: 'Strafe left',
  right: 'Strafe right',
  jump: 'Jump',
  sprint: 'Sprint',
  crouch: 'Crouch',
  fire: 'Fire',
  aim: 'Aim down sights',
  reload: 'Reload',
  interact: 'Interact / pick up',
  dropProp: 'Drop carried prop',
  weapon1: 'Weapon slot 1',
  weapon2: 'Weapon slot 2',
  weapon3: 'Weapon slot 3',
  weapon4: 'Weapon slot 4',
  weapon5: 'Weapon slot 5',
  scoreboard: 'Scoreboard',
  chat: 'Chat',
  debug: 'Debug overlay',
  sandbox: 'Sandbox cursor / panel',
};

export const DEFAULT_SETTINGS: UserSettings = {
  graphics: {
    quality: QualityLevel.High,
    shadows: true,
    shadowResolution: 2048,
    particles: QualityLevel.High,
    effects: QualityLevel.High,
    renderDistance: 220,
    fov: 90,
    postProcessing: true,
    antialias: true,
    resolutionScale: 1,
    showFps: true,
    showPing: true,
    debugOverlay: false,
  },
  audio: {
    master: 0.8,
    music: 0.4,
    effects: 0.9,
    voice: 0.8,
    ui: 0.6,
    ambience: 0.5,
  },
  controls: {
    sensitivity: 2.2,
    aimSensitivityMultiplier: 0.75,
    invertY: false,
    toggleSprint: false,
    toggleCrouch: false,
    toggleAim: false,
    bindings: { ...DEFAULT_BINDINGS },
  },
};

/** Preset bundles applied when the user picks a quality level. */
export const QUALITY_PRESETS = {
  [QualityLevel.Low]: {
    shadows: false,
    shadowResolution: 512,
    particles: QualityLevel.Low,
    effects: QualityLevel.Low,
    renderDistance: 110,
    postProcessing: false,
    antialias: false,
    resolutionScale: 0.75,
  },
  [QualityLevel.Medium]: {
    shadows: true,
    shadowResolution: 1024,
    particles: QualityLevel.Medium,
    effects: QualityLevel.Medium,
    renderDistance: 160,
    postProcessing: false,
    antialias: true,
    resolutionScale: 1,
  },
  [QualityLevel.High]: {
    shadows: true,
    shadowResolution: 2048,
    particles: QualityLevel.High,
    effects: QualityLevel.High,
    renderDistance: 220,
    postProcessing: true,
    antialias: true,
    resolutionScale: 1,
  },
  [QualityLevel.Ultra]: {
    shadows: true,
    shadowResolution: 4096,
    particles: QualityLevel.Ultra,
    effects: QualityLevel.Ultra,
    renderDistance: 320,
    postProcessing: true,
    antialias: true,
    resolutionScale: 1,
  },
} as const;

/** Numeric budgets derived from the quality level, used by the effect pools. */
export const PARTICLE_BUDGETS: Record<string, { max: number; impactCount: number; debris: number; decals: number }> = {
  [QualityLevel.Low]: { max: 260, impactCount: 3, debris: 2, decals: 24 },
  [QualityLevel.Medium]: { max: 700, impactCount: 6, debris: 5, decals: 64 },
  [QualityLevel.High]: { max: 1600, impactCount: 10, debris: 9, decals: 128 },
  [QualityLevel.Ultra]: { max: 3200, impactCount: 16, debris: 14, decals: 256 },
};

export function mergeSettings(base: UserSettings, patch: unknown): UserSettings {
  if (!patch || typeof patch !== 'object') return base;
  const p = patch as Partial<UserSettings>;
  const bindings = { ...base.controls.bindings, ...(p.controls?.bindings ?? {}) };
  // Ctrl+W closes the browser tab. Migrate the old default crouch off Control.
  if (bindings.crouch === 'ControlLeft' || bindings.crouch === 'ControlRight') {
    bindings.crouch = 'KeyC';
  }
  return {
    graphics: { ...base.graphics, ...(p.graphics ?? {}) },
    audio: { ...base.audio, ...(p.audio ?? {}) },
    controls: {
      ...base.controls,
      ...(p.controls ?? {}),
      bindings,
    },
  };
}
