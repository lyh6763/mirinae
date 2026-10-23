import * as THREE from 'three';
import type { Galaxy } from '../../gen/galaxy';
import type { StarSystem } from '../../gen/system';
import { NOISE_GLSL } from '../shaders/noise';
import { makeSky } from './bodies';
import { disposeScene, type Bloom, type CameraPose, type View, type ViewContext } from './view';

// 화면 전체를 덮는 사각형. 꼭짓점이 곧 화면 좌표(-1~1)다.
const QUAD_VERT = /* glsl */ `
varying vec2 vNdc;
void main() {
  vNdc = position.xy;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/*
 * 블랙홀 광선 추적. 단위는 슈바르츠실트 반지름(Rs = 1), 블랙홀은 원점.
 * 광자의 휘는 경로는 슈바르츠실트 측지선을 뉴턴식 힘으로 근사한 식 a = -1.5·h²·x / r⁵ 로 적분한다
 * (h = |x × v|, 광자마다 일정). 원반(y = 0 평면)을 지날 때마다 그 빛을 더하고, 지평선(r < 1)에 빠지면
 * 검게, 멀리 빠져나가면 그 방향의 하늘(그 자리에서 본 은하를 큐브맵에 담은 것)을 읽는다.
 */
const HOLE_FRAG = /* glsl */ `
${NOISE_GLSL}
uniform samplerCube uSky;
uniform float uHasSky;
uniform vec3 uCamPos;
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
uniform float uTime;
uniform float uInner;
uniform float uOuter;
uniform float uDiskGain;
uniform float uHeat;
uniform int uSteps;
varying vec2 vNdc;

// 원반 온도(0 차가움 ~ 1.5 뜨거움)를 색으로. 낮으면 검붉고, 높을수록 흰빛을 지나 푸르다.
vec3 diskColor(float t) {
  vec3 c = mix(vec3(0.45, 0.06, 0.01), vec3(1.0, 0.38, 0.08), smoothstep(0.1, 0.45, t));
  c = mix(c, vec3(1.0, 0.82, 0.55), smoothstep(0.45, 0.8, t));
  c = mix(c, vec3(0.92, 0.95, 1.0), smoothstep(0.8, 1.15, t));
  return mix(c, vec3(0.62, 0.74, 1.0), smoothstep(1.15, 1.6, t));
}

vec4 disk(vec3 p, float rd, vec3 vdir) {
  float phi = atan(p.z, p.x);
  // 케플러 회전: 안쪽일수록 빨리 돈다. 무늬를 그만큼 거꾸로 돌려 읽는다.
  float ang = phi - uTime * 1.4 / pow(rd, 1.5);
  vec3 q = vec3(cos(ang) * rd, sin(ang) * rd, rd * 0.4);
  float n = fbm(q * 0.75, 4) * 0.5 + 0.5;
  float rings = fbm(vec3(rd * 2.6, cos(ang) * 0.8, sin(ang) * 0.8), 3) * 0.5 + 0.5;
  float density = mix(n, rings, 0.55);
  float x = (rd - uInner) / (uOuter - uInner);
  float edge = smoothstep(0.0, 0.05, x) * smoothstep(1.0, 0.5, x);
  float temp = pow(uInner / rd, 0.75);
  // 도플러 효과: 우리 쪽으로 달려오는 쪽은 밝고 푸르게, 멀어지는 쪽은 어둡고 붉게.
  float beta = sqrt(0.5 / rd);
  vec3 vdisk = beta * vec3(-sin(phi), 0.0, cos(phi));
  float gamma = inversesqrt(1.0 - beta * beta);
  float dop = 1.0 / (gamma * (1.0 - dot(vdisk, -vdir)));
  // 중력 적색편이
  float g = dop * sqrt(max(1.0 - 1.0 / rd, 0.02));
  vec3 c = diskColor(temp * g * uHeat);
  float intensity = pow(g, 3.0) * temp * (0.3 + 0.95 * density);
  float alpha = clamp(edge * (0.3 + 0.7 * density), 0.0, 0.94);
  return vec4(c * intensity * uDiskGain, alpha);
}

void main() {
  vec4 view = uInvProj * vec4(vNdc, 1.0, 1.0);
  vec3 dir = normalize((uCamWorld * vec4(normalize(view.xyz / view.w), 0.0)).xyz);
  vec3 pos = uCamPos;
  vec3 vel = dir;
  vec3 hv = cross(pos, vel);
  float h2 = dot(hv, hv);
  vec3 col = vec3(0.0);
  float trans = 1.0;
  bool captured = false;

  for (int i = 0; i < uSteps; i++) {
    float r2 = dot(pos, pos);
    float r = sqrt(r2);
    if (r < 1.0) { captured = true; break; }
    if (r > 90.0 && dot(pos, vel) > 0.0) break;
    float dt = clamp(0.055 * r, 0.025, 5.0);
    vec3 prev = pos;
    vel += -1.5 * h2 * pos / (r2 * r2 * r) * dt;
    pos += vel * dt;
    if (prev.y * pos.y < 0.0) {
      vec3 hit = mix(prev, pos, prev.y / (prev.y - pos.y));
      float rd = length(hit.xz);
      if (rd > uInner && rd < uOuter) {
        vec4 d = disk(hit, rd, normalize(vel));
        col += trans * d.rgb * d.a;
        trans *= 1.0 - d.a;
        if (trans < 0.01) break;
      }
    }
  }

  if (!captured && uHasSky > 0.5) col += trans * textureCube(uSky, normalize(vel)).rgb;
  gl_FragColor = vec4(col, 1.0);
}
`;

/** 블랙홀 화면. 은하 중심의 초대질량 블랙홀은 원반이 크고 붉으며, 항성 블랙홀은 작고 희푸르다. */
export class BlackHoleView implements View {
  readonly scene = new THREE.Scene();
  readonly bloom: Bloom = { strength: 0.85, radius: 0.6, threshold: 0.6 };
  // 픽셀마다 광선을 수백 걸음 적분하므로 고해상도 화면에서는 해상도를 조금 낮춘다(2배 → 1.25배).
  readonly maxPixelRatio = 1.25;
  private material: THREE.ShaderMaterial;
  private skyScene = new THREE.Scene();
  private cube: THREE.WebGLCubeRenderTarget | null = null;

  constructor(galaxy: Galaxy, readonly system: StarSystem, _ctx: ViewContext) {
    const star = system.star;
    const core = star.kind === 'core';
    const origin = new THREE.Vector3().fromArray(galaxy.positions, star.index * 3);
    // 큐브맵 한 면이 512픽셀이라 하늘 별은 픽셀 비율 1로 찍는다.
    this.skyScene.add(makeSky(galaxy, origin, 1));

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uSky: { value: null },
        uHasSky: { value: 0 },
        uCamPos: { value: new THREE.Vector3() },
        uInvProj: { value: new THREE.Matrix4() },
        uCamWorld: { value: new THREE.Matrix4() },
        uTime: { value: 0 },
        uInner: { value: 3 },
        uOuter: { value: core ? 16 : 11 },
        uDiskGain: { value: core ? 1.5 : 2.0 },
        uHeat: { value: core ? 0.8 : 1.25 },
        uSteps: { value: 320 },
      },
      vertexShader: QUAD_VERT,
      fragmentShader: HOLE_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    quad.frustumCulled = false;
    quad.renderOrder = -100;
    this.scene.add(quad);
  }

  /** 그 자리에서 본 은하 하늘을 큐브맵에 한 번 그려 둔다. 렌더러가 있어야 해서 생성자와 따로 부른다. */
  prepare(renderer: THREE.WebGLRenderer): void {
    if (this.cube) return;
    this.cube = new THREE.WebGLCubeRenderTarget(512, { type: THREE.HalfFloatType, generateMipmaps: false });
    const cam = new THREE.CubeCamera(0.1, 20000, this.cube);
    cam.update(renderer, this.skyScene);
    this.material.uniforms.uSky.value = this.cube.texture;
    this.material.uniforms.uHasSky.value = 1;
  }

  home(): CameraPose {
    const core = this.system.star.kind === 'core';
    const d = core ? 34 : 26;
    return {
      position: new THREE.Vector3(0, d * 0.085, d),
      target: new THREE.Vector3(0, 0, 0),
      fov: 50, near: 0.1, far: 1000,
      minDistance: 5, maxDistance: 85,
    };
  }

  update(_dt: number, time: number, camera: THREE.PerspectiveCamera): void {
    camera.updateMatrixWorld();
    const u = this.material.uniforms;
    u.uCamPos.value.copy(camera.position);
    u.uInvProj.value.copy(camera.projectionMatrixInverse);
    u.uCamWorld.value.copy(camera.matrixWorld);
    u.uTime.value = time;
  }

  dispose(): void {
    disposeScene(this.scene);
    disposeScene(this.skyScene);
    this.cube?.dispose();
  }
}
