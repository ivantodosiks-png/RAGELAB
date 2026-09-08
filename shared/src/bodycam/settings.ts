/** Modular bodycam configuration — chest-mounted digital camera look. */
export interface BodycamSettings {
  /** Master enable. When off, classic eye-level FPS camera. */
  enabled: boolean;

  // ── Mount / motion (CameraRig) ───────────────────────────────────────────
  /** Chest height as fraction of standing eye height (≈0.72–0.82). */
  chestHeight: number;
  /** Forward push from torso center (meters). */
  forwardOffset: number;
  /** Slight downward pitch bias (radians). */
  pitchBias: number;
  /** Extra FOV degrees for wide-angle bodycam. */
  fovBoost: number;
  /** Walk bob intensity 0–1. */
  walkBob: number;
  /** Run bob intensity 0–1. */
  runBob: number;
  /** Rotational lag / stabilization 0–1 (higher = more lag). */
  cameraLag: number;
  /** Global shake multiplier 0–1. */
  shakeIntensity: number;

  // ── Lens (post-process) ──────────────────────────────────────────────────
  /** Barrel / wide-angle distortion 0–1. */
  barrelDistortion: number;
  /** Optical corner vignette 0–1. */
  vignette: number;
  /** Edge-only chromatic aberration 0–1. */
  chromaticAberration: number;
  /** Softness toward frame edges 0–1. */
  edgeBlur: number;

  // ── Sensor (post-process) ────────────────────────────────────────────────
  /** Digital noise / grain 0–1. */
  noise: number;
  /** Mild unsharp mask 0–1. */
  sharpening: number;
  /** Motion blur strength 0–1. */
  motionBlur: number;

  // ── Exposure ─────────────────────────────────────────────────────────────
  autoExposure: boolean;
  /** Adaptation speed 0.1–4. */
  exposureSpeed: number;
  minExposure: number;
  maxExposure: number;
  /** Auto white-balance strength 0–1. */
  whiteBalance: number;

  // ── Recording HUD ────────────────────────────────────────────────────────
  showRec: boolean;
  showMeta: boolean;
}

export const DEFAULT_BODYCAM: BodycamSettings = {
  enabled: true,
  chestHeight: 0.76,
  forwardOffset: 0.14,
  pitchBias: -0.06,
  fovBoost: 18,
  walkBob: 0.55,
  runBob: 0.85,
  cameraLag: 0.42,
  shakeIntensity: 0.7,
  barrelDistortion: 0.38,
  vignette: 0.42,
  chromaticAberration: 0.22,
  edgeBlur: 0.28,
  noise: 0.2,
  sharpening: 0.25,
  motionBlur: 0.35,
  autoExposure: true,
  exposureSpeed: 1.1,
  minExposure: 0.55,
  maxExposure: 1.65,
  whiteBalance: 0.35,
  showRec: true,
  showMeta: true,
};

/** Scale bodycam post effects by graphics quality. */
export function bodycamQualityScale(quality: string): {
  post: boolean;
  exposure: boolean;
  motionBlur: boolean;
  noise: number;
  samples: number;
} {
  switch (quality) {
    case 'low':
      return { post: true, exposure: false, motionBlur: false, noise: 0.45, samples: 0 };
    case 'medium':
      return { post: true, exposure: true, motionBlur: true, noise: 0.75, samples: 1 };
    case 'ultra':
      return { post: true, exposure: true, motionBlur: true, noise: 1, samples: 3 };
    default:
      return { post: true, exposure: true, motionBlur: true, noise: 0.9, samples: 2 };
  }
}
