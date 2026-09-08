/** Modular bodycam configuration — chest-mounted digital camera look. */
export interface BodycamSettings {
  /** Master enable. When off, classic eye-level FPS camera. */
  enabled: boolean;

  // ── Mount / motion (CameraRig) ───────────────────────────────────────────
  /** Chest height as fraction of standing eye height (≈0.72–0.82). */
  chestHeight: number;
  /** Forward push from torso center (meters). */
  forwardOffset: number;
  /** Slight downward pitch bias (radians). Static offset only — never smoothed. */
  pitchBias: number;
  /** Extra FOV degrees (keep low — no fisheye). */
  fovBoost: number;
  /** Walk bob intensity 0–1 (subtle vest motion). */
  walkBob: number;
  /** Run bob intensity 0–1. */
  runBob: number;
  /**
   * Deprecated: mouse look is always instant. Kept for save compatibility.
   * @deprecated
   */
  cameraLag: number;
  /** Global shake multiplier 0–1. */
  shakeIntensity: number;

  // ── Lens (post-process) ──────────────────────────────────────────────────
  /**
   * Deprecated: barrel/fisheye disabled — image stays proportional.
   * @deprecated
   */
  barrelDistortion: number;
  /** Soft corner darkening 0–1 (no warp). */
  vignette: number;
  /** Very mild edge chromatic aberration 0–1 (no geometry warp). */
  chromaticAberration: number;
  /** Deprecated edge softness — kept for saves, unused when distortion-free. */
  edgeBlur: number;

  // ── Sensor (post-process) ────────────────────────────────────────────────
  /** Digital noise / grain 0–1. */
  noise: number;
  /** Mild unsharp mask 0–1. */
  sharpening: number;
  /** Motion blur strength 0–1 (only on fast turns). */
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
  chestHeight: 0.74,
  forwardOffset: 0.12,
  pitchBias: -0.03,
  fovBoost: 6,
  walkBob: 0.38,
  runBob: 0.55,
  cameraLag: 0,
  shakeIntensity: 0.55,
  barrelDistortion: 0,
  vignette: 0.28,
  chromaticAberration: 0.12,
  edgeBlur: 0,
  noise: 0.18,
  sharpening: 0.22,
  motionBlur: 0.22,
  autoExposure: true,
  exposureSpeed: 0.95,
  minExposure: 0.5,
  maxExposure: 1.7,
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
      return { post: true, exposure: false, motionBlur: false, noise: 0.4, samples: 0 };
    case 'medium':
      return { post: true, exposure: true, motionBlur: true, noise: 0.7, samples: 1 };
    case 'ultra':
      return { post: true, exposure: true, motionBlur: true, noise: 1, samples: 3 };
    default:
      return { post: true, exposure: true, motionBlur: true, noise: 0.85, samples: 2 };
  }
}
