import type { SoundKey } from './synth';

const BASE = import.meta.env.BASE_URL;

/**
 * Recorded one-shots served from `client/public/sounds`. Vite copies that
 * folder into the build. Distant variants replace the close shot when another
 * player fires far from the listener.
 */
export const RECORDED_SAMPLES: Partial<Record<SoundKey, string>> = {
  pistol: `${BASE}sounds/glock_17_shot.wav`,
  pistol_distant: `${BASE}sounds/glock_17_shot_distant.wav`,
  pistol_reload: `${BASE}sounds/glock_17_reload.wav`,
  rifle: `${BASE}sounds/m4a1_shot.wav`,
  rifle_distant: `${BASE}sounds/m4a1_shot_distant.wav`,
  shotgun: `${BASE}sounds/remington_870_shot.wav`,
  shotgun_distant: `${BASE}sounds/remington_870_shot_distant.wav`,
};

export const DISTANT_FOR: Partial<Record<SoundKey, SoundKey>> = {
  pistol: 'pistol_distant',
  rifle: 'rifle_distant',
  shotgun: 'shotgun_distant',
};

/** Metres from the listener before a distant recording is used. */
export const DISTANT_FIRE_RANGE = 28;

export function isRecordedGunshot(key: string): boolean {
  return key === 'pistol' || key === 'rifle' || key === 'shotgun';
}
