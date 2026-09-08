import * as THREE from 'three';
import type { BodycamSettings } from '@ragelab/shared';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tDiffuse;
uniform vec2 uResolution;
uniform vec2 uLensCenter;
uniform float uLensRadius;
uniform float uFisheye;
uniform float uChroma;
uniform float uEdgeBlur;
uniform float uTime;
varying vec2 vUv;

vec2 barrel(vec2 uv, float amount) {
  vec2 c = uLensCenter;
  vec2 d = uv - c;
  // Correct for non-square aspect so the lens stays circular.
  float aspect = uResolution.x / max(uResolution.y, 1.0);
  d.x *= aspect;
  float r2 = dot(d, d);
  float f = 1.0 + amount * r2;
  d *= f;
  d.x /= aspect;
  return c + d;
}

void main() {
  vec2 uv = vUv;
  vec2 center = uLensCenter;
  vec2 d = uv - center;
  float aspect = uResolution.x / max(uResolution.y, 1.0);
  vec2 dn = vec2(d.x * aspect, d.y);
  float dist = length(dn);
  float radius = uLensRadius;

  float inside = 1.0 - smoothstep(radius * 0.92, radius * 1.05, dist);
  vec2 distorted = mix(uv, barrel(uv, uFisheye * 1.35), inside);

  // Edge softness toward the rim (cheap multi-tap).
  float edge = smoothstep(radius * 0.55, radius * 0.98, dist) * uEdgeBlur * inside;
  vec2 px = edge / uResolution;

  vec2 dir = normalize(distorted - center + 1e-5);
  float ca = uChroma * 0.0045 * inside * (0.35 + dist / max(radius, 1e-3));

  float r = texture2D(tDiffuse, distorted + dir * ca + px * 0.4).r;
  float g = texture2D(tDiffuse, distorted).g;
  float b = texture2D(tDiffuse, distorted - dir * ca - px * 0.4).b;

  if (edge > 0.01) {
    vec3 blur =
      texture2D(tDiffuse, distorted + vec2( px.x, 0.0)).rgb +
      texture2D(tDiffuse, distorted + vec2(-px.x, 0.0)).rgb +
      texture2D(tDiffuse, distorted + vec2(0.0,  px.y)).rgb +
      texture2D(tDiffuse, distorted + vec2(0.0, -px.y)).rgb;
    vec3 sharp = vec3(r, g, b);
    vec3 mixed = mix(sharp, blur * 0.25, clamp(edge, 0.0, 1.0));
    r = mixed.r; g = mixed.g; b = mixed.b;
  }

  gl_FragColor = vec4(r, g, b, 1.0);
}
`;

/**
 * Single-pass bodycam optics on the already-rendered frame.
 * No extra camera — scene renders into an RT, then a fullscreen quad warps it.
 */
export class BodycamPass {
  private rt: THREE.WebGLRenderTarget | null = null;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly material: THREE.ShaderMaterial;
  private readonly mesh: THREE.Mesh;
  private width = 1;
  private height = 1;
  private enabled = false;

  constructor() {
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null as THREE.Texture | null },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uLensCenter: { value: new THREE.Vector2(0.5, 0.48) },
        uLensRadius: { value: 0.42 },
        uFisheye: { value: 0.28 },
        uChroma: { value: 0.18 },
        uEdgeBlur: { value: 0.35 },
        uTime: { value: 0 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.scene.add(this.mesh);
  }

  needsPass(settings: BodycamSettings): boolean {
    return settings.enabled && (settings.fisheye > 0.01 || settings.chromaticAberration > 0.01 || settings.edgeBlur > 0.01);
  }

  applySettings(settings: BodycamSettings): void {
    this.enabled = this.needsPass(settings);
    const u = this.material.uniforms;
    u.uFisheye!.value = settings.fisheye;
    u.uChroma!.value = settings.chromaticAberration;
    u.uEdgeBlur!.value = settings.edgeBlur;
    // Shader UV y is bottom-origin; CSS uses top-origin — flip Y.
    u.uLensCenter!.value.set(settings.offsetX, 1 - settings.offsetY);
    // lensSize is vmin fraction of shorter side → radius in UV space (half).
    const shorter = Math.min(this.width, this.height);
    const diameterPx = settings.lensSize * shorter;
    const radiusUvY = diameterPx / (2 * Math.max(this.height, 1));
    u.uLensRadius!.value = radiusUvY;
  }

  resize(width: number, height: number, pixelRatio: number): void {
    const w = Math.max(1, Math.floor(width * pixelRatio));
    const h = Math.max(1, Math.floor(height * pixelRatio));
    if (w === this.width && h === this.height && this.rt) return;
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
    });
    this.material.uniforms.uResolution!.value.set(w, h);
    this.material.uniforms.tDiffuse!.value = this.rt.texture;
  }

  /** Bind RT as the destination for the upcoming scene draws. */
  begin(renderer: THREE.WebGLRenderer): boolean {
    if (!this.enabled || !this.rt) return false;
    renderer.setRenderTarget(this.rt);
    renderer.clear();
    return true;
  }

  /** Warp RT to the default framebuffer. */
  end(renderer: THREE.WebGLRenderer, timeSec: number): void {
    if (!this.enabled || !this.rt) return;
    this.material.uniforms.uTime!.value = timeSec;
    renderer.setRenderTarget(null);
    renderer.clear();
    renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.rt?.dispose();
    this.rt = null;
    this.material.dispose();
    this.mesh.geometry.dispose();
  }
}
