/** Shapes mirrored from the Supabase schema (see supabase/migrations). */

export interface Profile {
  id: string;
  username: string;
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PlayerStats {
  profileId: string;
  kills: number;
  deaths: number;
  headshots: number;
  shotsFired: number;
  shotsHit: number;
  matchesPlayed: number;
  wins: number;
  playtimeSeconds: number;
  xp: number;
  level: number;
  updatedAt: string;
}

export interface CosmeticItem {
  id: string;
  key: string;
  name: string;
  /** 'skin' | 'tracer' | 'charm' | 'title' - extensible without a migration. */
  itemType: string;
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
  /** Free-form renderer payload, e.g. { color: 16711680 }. */
  data: Record<string, unknown>;
}

export interface InventoryEntry {
  itemId: string;
  itemKey: string;
  equipped: boolean;
  acquiredAt: string;
}

export const QualityLevel = {
  Low: 'low',
  Medium: 'medium',
  High: 'high',
  Ultra: 'ultra',
} as const;
export type QualityLevelId = (typeof QualityLevel)[keyof typeof QualityLevel];

export interface GraphicsSettings {
  quality: QualityLevelId;
  shadows: boolean;
  shadowResolution: number;
  particles: QualityLevelId;
  effects: QualityLevelId;
  renderDistance: number;
  fov: number;
  postProcessing: boolean;
  antialias: boolean;
  /** Device pixel ratio cap. */
  resolutionScale: number;
  showFps: boolean;
  showPing: boolean;
  debugOverlay: boolean;
}

export interface AudioSettings {
  master: number;
  music: number;
  effects: number;
  voice: number;
  ui: number;
  /** Looping environment bed; routed through the music bus. */
  ambience: number;
}

export interface ControlSettings {
  sensitivity: number;
  aimSensitivityMultiplier: number;
  invertY: boolean;
  toggleSprint: boolean;
  toggleCrouch: boolean;
  toggleAim: boolean;
  /** action -> KeyboardEvent.code or 'Mouse0'/'Mouse1'/'Mouse2'. */
  bindings: Record<string, string>;
}

export interface UserSettings {
  graphics: GraphicsSettings;
  audio: AudioSettings;
  controls: ControlSettings;
}
