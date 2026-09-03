import {
  DEFAULT_SETTINGS,
  QUALITY_PRESETS,
  mergeSettings,
  type AudioSettings,
  type ControlSettings,
  type GraphicsSettings,
  type QualityLevelId,
  type UserSettings,
} from '@ragelab/shared';
import { EventBus } from '../core/eventBus';

const STORAGE_KEY = 'ragelab.settings.v1';

export interface SettingsEvents {
  changed: UserSettings;
  graphicsChanged: GraphicsSettings;
  audioChanged: AudioSettings;
  controlsChanged: ControlSettings;
}

/**
 * Settings live in localStorage for instant startup and are mirrored to
 * Supabase (`player_settings`) for signed-in players so they follow the account
 * across devices. localStorage always wins on load if it is newer.
 */
export class SettingsStore {
  readonly events = new EventBus<SettingsEvents>();
  private current: UserSettings;
  private remoteSaver: ((settings: UserSettings) => void) | null = null;
  private saveTimer: number | null = null;

  constructor() {
    this.current = this.load();
  }

  get value(): UserSettings {
    return this.current;
  }

  get graphics(): GraphicsSettings {
    return this.current.graphics;
  }

  get audio(): AudioSettings {
    return this.current.audio;
  }

  get controls(): ControlSettings {
    return this.current.controls;
  }

  private load(): UserSettings {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return structuredClone(DEFAULT_SETTINGS);
      return mergeSettings(structuredClone(DEFAULT_SETTINGS), JSON.parse(raw));
    } catch {
      return structuredClone(DEFAULT_SETTINGS);
    }
  }

  /** Called once the Supabase profile is known. */
  attachRemote(saver: (settings: UserSettings) => void): void {
    this.remoteSaver = saver;
  }

  /** Apply settings pulled from Supabase without echoing them straight back. */
  hydrateFromRemote(remote: unknown): void {
    if (!remote) return;
    this.current = mergeSettings(this.current, remote);
    this.persistLocal();
    this.emitAll();
  }

  patchGraphics(patch: Partial<GraphicsSettings>): void {
    this.current.graphics = { ...this.current.graphics, ...patch };
    this.afterChange();
    this.events.emit('graphicsChanged', this.current.graphics);
  }

  patchAudio(patch: Partial<AudioSettings>): void {
    this.current.audio = { ...this.current.audio, ...patch };
    this.afterChange();
    this.events.emit('audioChanged', this.current.audio);
  }

  patchControls(patch: Partial<ControlSettings>): void {
    this.current.controls = {
      ...this.current.controls,
      ...patch,
      bindings: { ...this.current.controls.bindings, ...(patch.bindings ?? {}) },
    };
    this.afterChange();
    this.events.emit('controlsChanged', this.current.controls);
  }

  setBinding(action: string, code: string): void {
    this.patchControls({ bindings: { [action]: code } });
  }

  /** Switching quality level rewrites the individual graphics toggles. */
  applyQualityPreset(quality: QualityLevelId): void {
    const preset = QUALITY_PRESETS[quality];
    this.patchGraphics({ quality, ...preset });
  }

  resetToDefaults(): void {
    this.current = structuredClone(DEFAULT_SETTINGS);
    this.afterChange();
    this.emitAll();
  }

  private emitAll(): void {
    this.events.emit('graphicsChanged', this.current.graphics);
    this.events.emit('audioChanged', this.current.audio);
    this.events.emit('controlsChanged', this.current.controls);
    this.events.emit('changed', this.current);
  }

  private afterChange(): void {
    this.persistLocal();
    this.events.emit('changed', this.current);
    this.scheduleRemoteSave();
  }

  private persistLocal(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.current));
    } catch {
      /* private browsing / quota - settings just will not persist */
    }
  }

  private scheduleRemoteSave(): void {
    if (!this.remoteSaver) return;
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      this.remoteSaver?.(this.current);
    }, 1500);
  }
}

export const settingsStore = new SettingsStore();
