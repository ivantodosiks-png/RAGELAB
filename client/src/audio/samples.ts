import type { SoundKey } from './synth';

/**
 * Recorded one-shots served from `client/public`. Vite copies that folder into
 * the build, so the M4 shot works in both `npm run dev` and production.
 */
export const RECORDED_SAMPLES: Partial<Record<SoundKey, string>> = {
  rifle: `${import.meta.env.BASE_URL}sounds/single-shot-m-1-rifle.mp3`,
};
