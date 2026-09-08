import * as THREE from 'three';
import {
  bodycamQualityScale,
  type BodycamSettings,
  type QualityLevelId,
} from '@ragelab/shared';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/**
 * Full-frame bodycam optics: safe wide-angle curve (no edge stretch) + soft vignette.
 * Barrel pulls samples inward so UVs stay inside the RT — FOV boost covers the field.
 */
const FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tDiffuse;
uniform vec2 uResolution;
uniform float uBarrel;
uniform float uVignette;
uniform float uChroma;
uniform float uEdgeBlur;
uniform float uNoise;
uniform float uSharpen;
uniform float uMotion;
uniform vec2 uMotionDir;
uniform float uExposure;
uniform vec3 uWB;
uniform float uTime;
uniform float uQualityNoise;
varying vec2 vUv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float luma(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

/**
 * Mild bodycam optic. Uses radial *compression* (divide), never outward stretch.
 * Outward multiply was sampling past the framebuffer → stretched edges.
 */
vec2 opticUv(vec2 uv, float amount) {
  vec2 c = vec2(0.5);
  vec2 d = uv - c;
  float aspect = uResolution.x / max(uResolution.y, 1.0);
  d.x *= aspect;
  float r2 = dot(d, d);
  float maxR2 = 0.25 * aspect * aspect + 0.25;
  float n = clamp(r2 / max(maxR2, 1e-4), 0.0, 1.0);
  float k = clamp(amount, 0.0, 1.0) * 0.14;
  // Brown–Conrady-ish: gentle mid-field curve, corners stay in-bounds.
  float f = 1.0 + k * n + (k * k) * n * n * 0.4;
  d /= f;
  d.x /= aspect;
  return c + d;
}

void main() {
  vec2 uv = vUv;
  float aspect = uResolution.x / max(uResolution.y, 1.0);
  vec2 d = uv - vec2(0.5);
  // Slightly elliptical falloff — looks more like a real lens/sensor than a circle.
  vec2 dn = vec2(d.x * aspect * 1.02, d.y * 1.12);
  float dist = length(dn);
  float corner = smoothstep(0.42, 0.92, dist);
  float corner2 = corner * corner;

  vec2 lensUv = opticUv(uv, uBarrel);

  vec2 mDir = uMotionDir;
  float mAmt = uMotion * corner * 0.007;
  vec2 radial = normalize(vec2((lensUv.x - 0.5) * aspect, lensUv.y - 0.5) + 1e-5);
  radial.x /= aspect;
  float ca = uChroma * 0.0018 * corner2;

  vec2 uvR = lensUv + radial * ca + mDir * mAmt * 0.25;
  vec2 uvG = lensUv;
  vec2 uvB = lensUv - radial * ca - mDir * mAmt * 0.25;

  vec3 col;
  col.r = texture2D(tDiffuse, uvR).r;
  col.g = texture2D(tDiffuse, uvG).g;
  col.b = texture2D(tDiffuse, uvB).b;

  if (uMotion > 0.04) {
    vec3 a = texture2D(tDiffuse, lensUv + mDir * mAmt * 0.4).rgb;
    vec3 b = texture2D(tDiffuse, lensUv - mDir * mAmt * 0.4).rgb;
    col = mix(col, (col + a + b) / 3.0, clamp(uMotion * corner * 0.28, 0.0, 0.28));
  }

  // Very soft peripheral softness — lens, not a blur filter.
  if (uEdgeBlur > 0.01) {
    vec2 px = (uEdgeBlur * corner * 0.9) / uResolution;
    vec3 blur =
      texture2D(tDiffuse, lensUv + vec2( px.x, 0.0)).rgb +
      texture2D(tDiffuse, lensUv + vec2(-px.x, 0.0)).rgb +
      texture2D(tDiffuse, lensUv + vec2(0.0,  px.y)).rgb +
      texture2D(tDiffuse, lensUv + vec2(0.0, -px.y)).rgb;
    blur *= 0.25;
    col = mix(col, blur, clamp(corner2 * uEdgeBlur * 0.28, 0.0, 0.28));
  }

  if (uSharpen > 0.01) {
    vec3 blur =
      texture2D(tDiffuse, lensUv + vec2(1.0, 0.0) / uResolution).rgb +
      texture2D(tDiffuse, lensUv + vec2(-1.0, 0.0) / uResolution).rgb +
      texture2D(tDiffuse, lensUv + vec2(0.0, 1.0) / uResolution).rgb +
      texture2D(tDiffuse, lensUv + vec2(0.0, -1.0) / uResolution).rgb;
    blur *= 0.25;
    col += (col - blur) * uSharpen * (1.0 - corner * 0.55);
  }

  col *= uExposure;
  col *= uWB;

  // Optical vignette — corners only, no hard aperture.
  float vig = 1.0 - uVignette * pow(clamp(dist * 1.05, 0.0, 1.2), 1.85);
  // Tiny center lift so the frame still reads as a lens, not a dark filter.
  float lift = 1.0 + (1.0 - corner) * 0.015 * uVignette;
  col *= clamp(vig * lift, 0.28, 1.02);

  float nAmt = uNoise * uQualityNoise;
  if (nAmt > 0.001) {
    float n = hash(gl_FragCoord.xy + vec2(uTime * 70.0, uTime * 19.0)) - 0.5;
    float dark = 1.0 - smoothstep(0.05, 0.42, luma(col));
    col += n * nAmt * (0.018 + dark * 0.04);
  }

  col = col / (1.0 + col * 0.05);
  gl_FragColor = vec4(clamp(col, 0.0, 4.0), 1.0);
}
`;

const LUM_FRAG = /* glsl */ `
precision mediump float;
uniform sampler2D tDiffuse;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tDiffuse, vec2(0.5)).rgb;
  c += texture2D(tDiffuse, vec2(0.35, 0.5)).rgb;
  c += texture2D(tDiffuse, vec2(0.65, 0.5)).rgb;
  c += texture2D(tDiffuse, vec2(0.5, 0.35)).rgb;
  c += texture2D(tDiffuse, vec2(0.5, 0.65)).rgb;
  c *= 0.2;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  gl_FragColor = vec4(l, c.r, c.b, 1.0);
}
`;

/**
 * Full-frame bodycam post — one RT (+ MSAA) + optional 1×1 luminance probe.
 * No second gameplay camera. No circular crop.
 */
export class BodycamPass {
  private rt: THREE.WebGLRenderTarget | null = null;
  private lumRt: THREE.WebGLRenderTarget | null = null;
  private readonly scene = new THREE.Scene();
  private readonly lumScene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly material: THREE.ShaderMaterial;
  private readonly lumMaterial: THREE.ShaderMaterial;
  private width = 1;
  private height = 1;
  private samples = 0;
  private enabled = false;
  private doExposure = false;
  private frame = 0;
  private exposure = 1;
  private wb = new THREE.Vector3(1, 1, 1);
  private readonly lumPixel = new Uint8Array(4);
  private settings: BodycamSettings | null = null;
  private quality: QualityLevelId = 'high';
  private wantAntialias = true;

  constructor() {
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null as THREE.Texture | null },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uBarrel: { value: 0.2 },
        uVignette: { value: 0.4 },
        uChroma: { value: 0.14 },
        uEdgeBlur: { value: 0.12 },
        uNoise: { value: 0.16 },
        uSharpen: { value: 0.22 },
        uMotion: { value: 0 },
        uMotionDir: { value: new THREE.Vector2(0, 0) },
        uExposure: { value: 1 },
        uWB: { value: new THREE.Vector3(1, 1, 1) },
        uTime: { value: 0 },
        uQualityNoise: { value: 1 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material));

    this.lumMaterial = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null as THREE.Texture | null } },
      vertexShader: VERT,
      fragmentShader: LUM_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.lumScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.lumMaterial));
  }

  needsPass(settings: BodycamSettings): boolean {
    return settings.enabled;
  }

  applySettings(
    settings: BodycamSettings,
    quality: QualityLevelId = 'high',
    antialias = true,
  ): void {
    this.settings = settings;
    this.quality = quality;
    this.wantAntialias = antialias;
    const q = bodycamQualityScale(quality);
    this.enabled = settings.enabled && q.post;
    this.doExposure = settings.enabled && settings.autoExposure && q.exposure;
    if (!this.doExposure) {
      this.exposure = 1;
      this.wb.set(1, 1, 1);
    }
    const u = this.material.uniforms;
    const low = quality === 'low';
    // Hard aperture/crop fields are ignored — optics are full-frame only.
    u.uBarrel!.value = settings.barrelDistortion * (low ? 0.7 : 1);
    u.uVignette!.value = settings.vignette * (low ? 0.8 : 1);
    u.uChroma!.value = settings.chromaticAberration * (low ? 0.45 : 1);
    u.uEdgeBlur!.value = low ? settings.edgeBlur * 0.4 : settings.edgeBlur;
    u.uNoise!.value = settings.noise;
    u.uSharpen!.value = low ? 0 : settings.sharpening;
    u.uQualityNoise!.value = q.noise;
    this.samples = antialias ? q.samples : 0;
  }

  /** Brief exposure kick (muzzle flash / nearby blast). */
  punchExposure(delta: number): void {
    if (!this.settings || !this.doExposure) return;
    this.exposure = clamp(
      this.settings.minExposure,
      this.settings.maxExposure,
      this.exposure + delta,
    );
  }

  setMotion(yawVel: number, pitchVel: number): void {
    if (!this.settings) return;
    const q = bodycamQualityScale(this.quality);
    if (!q.motionBlur) {
      this.material.uniforms.uMotion!.value = 0;
      return;
    }
    const mag = Math.hypot(yawVel, pitchVel);
    const strength = clamp01(mag * 0.12) * this.settings.motionBlur;
    this.material.uniforms.uMotion!.value = strength;
    const len = Math.max(1e-4, mag);
    this.material.uniforms.uMotionDir!.value.set(yawVel / len, -pitchVel / len);
  }

  resize(width: number, height: number, pixelRatio: number): void {
    const w = Math.max(1, Math.floor(width * pixelRatio));
    const h = Math.max(1, Math.floor(height * pixelRatio));
    const samples = this.wantAntialias ? this.samples : 0;
    if (w === this.width && h === this.height && this.rt && this.rt.samples === samples) return;
    this.width = w;
    this.height = h;
    this.rt?.dispose();
    this.rt = new THREE.WebGLRenderTarget(w, h, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: true,
      stencilBuffer: false,
      samples,
    });
    this.lumRt?.dispose();
    this.lumRt = new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: false,
      stencilBuffer: false,
    });
    this.material.uniforms.uResolution!.value.set(w, h);
    this.material.uniforms.tDiffuse!.value = this.rt.texture;
    this.lumMaterial.uniforms.tDiffuse!.value = this.rt.texture;
  }

  begin(renderer: THREE.WebGLRenderer): boolean {
    if (!this.enabled || !this.rt) return false;
    renderer.setRenderTarget(this.rt);
    renderer.clear();
    return true;
  }

  end(renderer: THREE.WebGLRenderer, timeSec: number, dt: number): void {
    if (!this.enabled || !this.rt) return;
    this.frame += 1;

    if (this.doExposure && this.lumRt && this.settings && this.frame % 3 === 0) {
      this.probeExposure(renderer, dt);
    } else if (this.settings) {
      const speed = this.settings.exposureSpeed * dt;
      this.exposure = THREE.MathUtils.lerp(this.exposure, 1, clamp01(speed * 0.15));
    }

    const u = this.material.uniforms;
    u.uTime!.value = timeSec;
    u.uExposure!.value = this.exposure;
    u.uWB!.value.copy(this.wb);

    renderer.setRenderTarget(null);
    renderer.clear();
    renderer.render(this.scene, this.camera);
  }

  private probeExposure(renderer: THREE.WebGLRenderer, dt: number): void {
    if (!this.lumRt || !this.settings) return;
    renderer.setRenderTarget(this.lumRt);
    renderer.clear();
    renderer.render(this.lumScene, this.camera);
    renderer.readRenderTargetPixels(this.lumRt, 0, 0, 1, 1, this.lumPixel);

    const lum = this.lumPixel[0]! / 255;
    const r = this.lumPixel[1]! / 255;
    const b = this.lumPixel[2]! / 255;
    const target = clamp(
      this.settings.minExposure,
      this.settings.maxExposure,
      0.32 / Math.max(0.04, lum),
    );
    const adapt = 1 - Math.exp(-this.settings.exposureSpeed * dt * 3);
    this.exposure = THREE.MathUtils.lerp(this.exposure, target, adapt);

    if (this.settings.whiteBalance > 0.01) {
      const temp = clamp(-1, 1, (r - b) * 2.2);
      const cool = new THREE.Vector3(0.96, 0.99, 1.06);
      const warm = new THREE.Vector3(1.08, 1.0, 0.92);
      const want = cool.clone().lerp(warm, temp * 0.5 + 0.5);
      this.wb.lerp(want, adapt * this.settings.whiteBalance);
    }
  }

  dispose(): void {
    this.rt?.dispose();
    this.lumRt?.dispose();
    this.rt = null;
    this.lumRt = null;
    this.material.dispose();
    this.lumMaterial.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
    this.lumScene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
  }
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function clamp(lo: number, hi: number, v: number): number {
  return Math.max(lo, Math.min(hi, v));
}
