import type { SoundKey } from './synth';

const BASE = import.meta.env.BASE_URL;

const AWM_SHOT_URL = new URL('../../../assets/awm/single-shot-with-awn.mp3', import.meta.url).href;
/** CC0 field recording — Desert Eagle .50AE, vabadus / Freesound 151071. */
const MAGNUM_SHOT_URL = new URL('../../../assets/hammer/deagle_50ae_shot.mp3', import.meta.url).href;

/**
 * Recorded one-shots. Most live in `client/public/sounds`; AWM / Hammer shots
 * load from repo `assets/` so we do not duplicate the files.
 */
export const RECORDED_SAMPLES: Partial<Record<SoundKey, string>> = {
  pistol: `${BASE}sounds/glock_17_shot.wav`,
  pistol_distant: `${BASE}sounds/glock_17_shot_distant.wav`,
  pistol_reload: `${BASE}sounds/glock_17_reload.wav`,
  rifle: `${BASE}sounds/m4a1_shot.wav`,
  rifle_distant: `${BASE}sounds/m4a1_shot_distant.wav`,
  shotgun: `${BASE}sounds/remington_870_shot.wav`,
  shotgun_distant: `${BASE}sounds/remington_870_shot_distant.wav`,
  sniper: AWM_SHOT_URL,
  magnum: MAGNUM_SHOT_URL,
  footstep_1: `${BASE}sounds/foot1.mp3`,
  footstep_2: `${BASE}sounds/foot2.mp3`,
};

export const DISTANT_FOR: Partial<Record<SoundKey, SoundKey>> = {
  pistol: 'pistol_distant',
  rifle: 'rifle_distant',
  shotgun: 'shotgun_distant',
};

/** Metres from the listener before a distant recording is used. */
export const DISTANT_FIRE_RANGE = 28;

export function isRecordedGunshot(key: string): boolean {
  return key === 'pistol' || key === 'rifle' || key === 'shotgun' || key === 'sniper' || key === 'magnum';
}
