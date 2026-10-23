import * as THREE from 'three';
import type { PlanetLook } from '../../gen/look';
import { Rng } from '../../gen/rng';
import { NOISE_GLSL } from './noise';

const SPHERE_VERT = /* glsl */ `
varying vec3 vObjPos;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
void main() {
  vObjPos = normalize(position);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

// ── 항성 표면: 쌀알 무늬(대류)와 흑점, 가장자리 어두워짐 ─────────────────────
const STAR_FRAG = /* glsl */ `
${NOISE_GLSL}
uniform vec3 uColor;
uniform float uTime;
varying vec3 vObjPos;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
void main() {
  vec3 n = normalize(vObjPos);
  float g = fbm(n * 7.0 + vec3(uTime * 0.04, 0.0, uTime * 0.02), 5);
  float cells = ridged(n * 14.0 - vec3(0.0, uTime * 0.05, 0.0), 3);
  float spots = smoothstep(0.32, 0.5, fbm(n * 2.2 + vec3(uTime * 0.006), 3));
  vec3 V = normalize(cameraPosition - vWorldPos);
  float mu = max(dot(normalize(vWorldNormal), V), 0.0);
  float limb = 0.35 + 0.65 * pow(mu, 0.5);
  vec3 col = uColor * (2.2 + g * 1.1 + cells * 0.6);
  col *= 1.0 - spots * 0.55;
  gl_FragColor = vec4(col * limb, 1.0);
}
`;

export function starSurfaceMaterial(color: THREE.Color): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: color.clone() }, uTime: { value: 0 } },
    vertexShader: SPHERE_VERT,
    fragmentShader: STAR_FRAG,
  });
}

// ── 지형 높이: 행성 표면(조각 셰이더)과 저공비행 지면(꼭짓점 셰이더)이 함께 쓴다 ──────────
// CPU 쪽 같은 식은 gen/terrain.ts의 surfaceHeight.
export const TERRAIN_GLSL = /* glsl */ `
uniform int uKind;
uniform int uOctaves;
uniform float uSea;
uniform float uScale;
uniform float uWarp;
uniform vec3 uOffset;

float terrain(vec3 p, out float moisture, out float ridge) {
  vec3 q = p * uScale + uOffset;
  vec3 w = vec3(snoise(q * 0.55), snoise(q * 0.55 + 17.3), snoise(q * 0.55 + 41.9));
  q += w * uWarp;
  float h = fbm(q, uOctaves);
  ridge = ridged(q * 1.6 + 3.1, 4);
  h += (ridge - 0.33) * 0.42 * smoothstep(-0.05, 0.3, h);
  moisture = snoise(q * 0.7 + 9.1) * 0.5 + 0.5;
  return h;
}

float lavaHeight(vec3 p) {
  vec3 q = p * uScale + uOffset;
  return fbm(q + vec3(snoise(q * 0.5)) * uWarp, uOctaves);
}

/** 바다가 있으면 해수면 아래를 해수면으로 맞춘 높이 */
float surfaceHeight(vec3 p) {
  if (uKind == 2) return lavaHeight(p);
  float m, r;
  float h = terrain(p, m, r);
  return uSea > -1.5 ? max(h, uSea) : h;
}
`;

// ── 행성 표면 ────────────────────────────────────────────────────────────────
const PLANET_FRAG = /* glsl */ `
${NOISE_GLSL}
${TERRAIN_GLSL}
uniform vec3 uDeep, uShallow, uSand, uLow, uLow2, uHigh, uPeak;
uniform float uIce;
uniform float uCity;
uniform float uEmissive;
uniform float uCracks;
uniform vec3 uBand1, uBand2, uBand3;
uniform vec3 uSpot;
uniform vec3 uLightPos;
uniform vec3 uLightColor;
// 쌍성의 둘째 해. 홑별이면 색이 검정이라 아무 영향이 없다.
uniform vec3 uLightPos2;
uniform vec3 uLightColor2;
uniform float uTime;
uniform float uBump;
varying vec3 vObjPos;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
#ifdef FLIGHT
// 저공비행: 멀수록 대기 색에 묻히고, 바다에 잔물결이 인다.
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uWave;
varying float vFlightDist;
#endif

// 화면 미분으로 높이의 기울기를 구해 법선을 비튼다 (Mikkelsen 방식). 노이즈를 한 번만 계산해도 된다.
vec3 bumpNormal(vec3 pos, vec3 n, float h, float strength) {
  vec3 dpdx = dFdx(pos);
  vec3 dpdy = dFdy(pos);
  vec3 r1 = cross(dpdy, n);
  vec3 r2 = cross(n, dpdx);
  float det = dot(dpdx, r1);
  vec3 grad = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2) * strength;
  return normalize(abs(det) * n - grad);
}

vec3 lightRock(vec3 albedo, vec3 N) {
  vec3 L1 = normalize(uLightPos - vWorldPos);
  vec3 L2 = normalize(uLightPos2 - vWorldPos);
  vec3 light = uLightColor * max(dot(N, L1), 0.0) + uLightColor2 * max(dot(N, L2), 0.0);
  return albedo * (light * 1.15 + 0.012);
}

void main() {
  vec3 p = normalize(vObjPos);
  vec3 N = normalize(vWorldNormal);
  vec3 L = normalize(uLightPos - vWorldPos);
  vec3 L2 = normalize(uLightPos2 - vWorldPos);
  vec3 V = normalize(cameraPosition - vWorldPos);
  float has2 = step(0.001, dot(uLightColor2, vec3(1.0)));
  // 낮과 밤의 경계는 두 해 중 더 높이 뜬 쪽을 따른다.
  float sun = max(dot(N, L), mix(-1.0, dot(N, L2), has2));
  vec3 col;

  if (uKind == 1) {
    // 가스 거인: 위도 띠 + 경도 방향 난류 + 큰 폭풍 하나
    float lat = p.y;
    vec3 q = vec3(p.x * 2.2, lat * uScale * 0.55, p.z * 2.2) + uOffset;
    float turb = fbm(q + vec3(uTime * 0.012, 0.0, 0.0), 5);
    float band = sin((lat * uScale + turb * uWarp * 2.4) * 3.14159);
    col = mix(uBand1, uBand2, smoothstep(-0.7, 0.7, band));
    float fine = fbm(vec3(p.x * 5.0, lat * uScale * 2.6, p.z * 5.0) + uOffset * 1.7, 4);
    col = mix(col, uBand3, smoothstep(0.0, 0.6, fine) * 0.55);
    vec3 sp = normalize(uSpot);
    vec3 dd = p - sp;
    float spot = length(vec3(dd.x, dd.y * 1.9, dd.z));
    float swirl = fbm(p * 18.0 + uOffset, 3) * 0.04;
    col = mix(col, uBand2 * 0.75 + vec3(0.12, 0.04, 0.0), smoothstep(0.17, 0.09, spot + swirl) * 0.85);
    col = lightRock(col, N) * 0.96;
  } else if (uKind == 2) {
    // 용암 행성: 식은 껍질 사이로 갈라진 틈과 낮은 땅에 용암이 빛난다
    vec3 q = p * uScale + uOffset;
    float h = lavaHeight(p);
    float cracks = ridged(q * 1.4 + 2.0, 5);
    vec3 crust = mix(uLow, uHigh, smoothstep(-0.3, 0.4, h));
    crust = mix(crust, uPeak, smoothstep(0.35, 0.6, h));
    vec3 Nb = bumpNormal(vWorldPos, N, h, uBump);
    col = lightRock(crust, Nb);
    float lava = smoothstep(0.66, 0.92, cracks) + smoothstep(-0.12, -0.4, h);
    lava = clamp(lava, 0.0, 1.0);
    float pulse = 0.85 + 0.15 * sin(uTime * 0.8 + h * 24.0);
    vec3 hot = mix(vec3(1.0, 0.18, 0.02), vec3(1.0, 0.72, 0.28), lava);
    col += hot * lava * uEmissive * pulse * 2.4;
  } else {
    float moist, ridge;
    float h = terrain(p, moist, ridge);
    float lat = abs(p.y);
    bool water = h < uSea;
    float base = max(uSea, -0.55);
    float e = clamp((h - base) / (0.62 - base), 0.0, 1.0);
    float ice = smoothstep(1.0 - uIce - 0.03, 1.0 - uIce + 0.03, lat + snoise(p * 7.0 + uOffset) * 0.06);
    ice = max(ice, smoothstep(0.78, 0.88, e) * step(0.05, uIce));
    vec3 albedo;
    if (water) {
      float depth = clamp((uSea - h) * 3.5, 0.0, 1.0);
      albedo = mix(uShallow, uDeep, sqrt(depth));
    } else {
      float dryness = clamp(moist * 0.8 + lat * 0.25 + e * 0.3, 0.0, 1.0);
      vec3 lowland = mix(uLow, uLow2, smoothstep(0.35, 0.75, dryness));
      albedo = lowland;
      if (uSea > -1.5) albedo = mix(uSand, albedo, smoothstep(0.0, 0.035, e));
      albedo = mix(albedo, uHigh, smoothstep(0.32, 0.58, e));
      albedo = mix(albedo, uPeak, smoothstep(0.62, 0.85, e));
      // 얼음 행성의 갈라진 틈
      albedo = mix(albedo, uShallow, smoothstep(0.82, 0.96, ridge) * uCracks * 0.7);
    }
    albedo = mix(albedo, vec3(0.93, 0.96, 1.0), ice);
    // 미분은 분기 밖에서 구해야 값이 정의된다.
    vec3 Nbump = bumpNormal(vWorldPos, N, h, uBump);
    vec3 Nb = water && ice < 0.5 ? N : Nbump;
#ifdef FLIGHT
    if (water && ice < 0.5) {
      vec3 wq = p * 900.0;
      Nb = normalize(N + uWave * vec3(
        snoise(wq + vec3(uTime * 0.4, 0.0, 0.0)),
        snoise(wq + vec3(7.1, uTime * 0.3, 0.0)),
        snoise(wq + vec3(0.0, 3.3, uTime * 0.35))));
    }
#endif
    col = lightRock(albedo, Nb);
    if (water && ice < 0.5) {
      vec3 H = normalize(L + V);
      vec3 H2 = normalize(L2 + V);
      col += uLightColor * pow(max(dot(Nb, H), 0.0), 70.0) * 0.55 * smoothstep(0.0, 0.2, dot(N, L));
      col += uLightColor2 * pow(max(dot(Nb, H2), 0.0), 70.0) * 0.55 * smoothstep(0.0, 0.2, dot(N, L2));
    }
    // 문명이 있는 행성은 밤 쪽에 도시 불빛이 보인다. 육지가 거의 없는 바다 행성은 바다 위에 도시를 띄운다.
    if (uCity > 0.5 && ice < 0.5) {
      float night = smoothstep(0.08, -0.18, sun);
      float cluster = smoothstep(0.52, 0.82, snoise(p * 4.5 + uOffset * 1.3) * 0.5 + 0.5);
      float grain = smoothstep(0.35, 0.9, snoise(p * 70.0 + uOffset));
      float site = water
        ? step(0.4, uSea) * 0.6
        : smoothstep(0.0, 0.08, e) * (1.0 - smoothstep(0.35, 0.6, e));
      col += vec3(1.0, 0.6, 0.28) * grain * cluster * site * night * 2.6;
    }
  }

#ifdef FLIGHT
  // 제곱 지수 안개: 가까운 지형은 맑게 두고, 지평선 가까이에서 하늘의 지평선 색에 녹아든다.
  float fd = vFlightDist * uFogDensity;
  col = mix(col, uFogColor, 1.0 - exp(-fd * fd));
#endif
  gl_FragColor = vec4(col, 1.0);
}
`;

// 저공비행 지면: 카메라를 따라다니는 격자. 격자 칸 크기 단위로만 옮겨 지형이 출렁이지 않게 하고,
// 각 꼭짓점을 구 위의 방향으로 바꾼 뒤 그 방향의 지형 높이만큼 들어 올린다.
const FLIGHT_VERT = /* glsl */ `
${NOISE_GLSL}
${TERRAIN_GLSL}
uniform vec3 uC0;
uniform vec3 uT;
uniform vec3 uB;
uniform vec2 uGridCenter;
uniform float uR;
uniform float uAmp;
varying vec3 vObjPos;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying float vFlightDist;
void main() {
  vec2 xz = position.xz + uGridCenter;
  vec3 dir = normalize(uC0 * uR + uT * xz.x + uB * xz.y);
  vec3 world = dir * (uR + uAmp * surfaceHeight(dir));
  vObjPos = dir;
  // 조각 셰이더의 범프 법선이 높이 기울기를 다시 더하므로, 위치·법선은 들어 올리기 전 구면 기준으로 넘긴다.
  vWorldPos = dir * uR;
  vWorldNormal = dir;
  vec4 mv = viewMatrix * vec4(world, 1.0);
  vFlightDist = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

/** 저공비행 지면 재질. 행성 화면과 같은 겉모습·노이즈를 쓰고 안개·잔물결을 더한다. */
export function flightMaterial(look: PlanetLook, seed: number, amp: number, radius: number): THREE.ShaderMaterial {
  const base = planetMaterial(look, seed, 7);
  base.uniforms.uBump.value = amp;
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      ...base.uniforms,
      uC0: { value: new THREE.Vector3(0, 1, 0) },
      uT: { value: new THREE.Vector3(1, 0, 0) },
      uB: { value: new THREE.Vector3(0, 0, 1) },
      uGridCenter: { value: new THREE.Vector2() },
      uR: { value: radius },
      uAmp: { value: amp },
      uFogColor: { value: new THREE.Color(0, 0, 0) },
      uFogDensity: { value: 0.016 },
      uWave: { value: 0.12 },
    },
    defines: { FLIGHT: '' },
    vertexShader: FLIGHT_VERT,
    fragmentShader: PLANET_FRAG,
    // 격자를 구면으로 휘면서 면 방향이 뒤집히는 일이 없도록 양면을 그린다.
    side: THREE.DoubleSide,
  });
  base.dispose();
  return mat;
}

// 저공비행 하늘: 대기가 있으면 지평선이 밝고 천정이 짙다. 해가 낮으면 지평선이 붉어진다.
// 더하기 혼합이라 어두운 하늘에서는 뒤의 별이 비친다.
const SKY_DOME_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_Position.z = gl_Position.w * 0.9999;
}
`;

const SKY_DOME_FRAG = /* glsl */ `
uniform vec3 uUp;
uniform vec3 uSunDir;
uniform vec3 uAtmo;
uniform float uDensity;
uniform vec3 uSunColor;
// 쌍성의 둘째 해
uniform vec3 uSunDir2;
uniform vec3 uSunColor2;
uniform float uHas2;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = dot(d, uUp);
  float up1 = dot(uSunDir, uUp);
  float up2 = mix(-1.0, dot(uSunDir2, uUp), uHas2);
  // 하늘의 밝기와 노을은 더 높이 뜬 해를 따른다.
  float sunUp = max(up1, up2);
  float day = smoothstep(-0.22, 0.2, sunUp);
  float low = (1.0 - smoothstep(-0.05, 0.35, sunUp)) * day;
  vec3 zenith = uAtmo * 0.28;
  vec3 horizon = mix(uAtmo * 0.95, vec3(1.0, 0.5, 0.25), low * 0.75);
  vec3 col = mix(horizon, zenith, smoothstep(0.0, 0.55, max(h, 0.0))) * (0.04 + 0.96 * day);
  // 높이 떠 있으면 실제 지평선은 수평보다 아래에 있다. 그 사이가 어둡게 보이지 않도록 훨씬 아래에서부터 어둡힌다.
  col *= smoothstep(-0.55, -0.15, h);
  float sd1 = max(dot(d, uSunDir), 0.0);
  float sd2 = max(dot(d, uSunDir2), 0.0) * uHas2;
  col += uSunColor * pow(sd1, 10.0) * 0.35 * smoothstep(-0.22, 0.2, up1);
  col += uSunColor2 * pow(sd2, 10.0) * 0.35 * smoothstep(-0.22, 0.2, up2);
  col *= uDensity;
  // 해 원반은 대기가 없어도 보인다. 둘째 해는 조금 작다.
  col += uSunColor * smoothstep(0.9994, 0.99975, sd1) * 6.0;
  col += uSunColor2 * smoothstep(0.99955, 0.9998, sd2) * 5.0;
  gl_FragColor = vec4(col, 1.0);
}
`;

export function skyDomeMaterial(atmo: THREE.Color, density: number, sunColor: THREE.Color, sunColor2?: THREE.Color): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uUp: { value: new THREE.Vector3(0, 1, 0) },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uAtmo: { value: atmo.clone() },
      uDensity: { value: density },
      uSunColor: { value: sunColor.clone() },
      uSunDir2: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor2: { value: sunColor2?.clone() ?? new THREE.Color(0, 0, 0) },
      uHas2: { value: sunColor2 ? 1 : 0 },
    },
    vertexShader: SKY_DOME_VERT,
    fragmentShader: SKY_DOME_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    // 가장 먼 깊이에 그려 지형에 가려지게 한다. 끄면 하늘색이 지형 위에 더해져 뿌옇게 된다.
    depthTest: true,
    transparent: true,
    blending: THREE.AdditiveBlending,
  });
}

function linear(hex: string): THREE.Color {
  return new THREE.Color(hex);
}

export function planetMaterial(look: PlanetLook, seed: number, octaves = 6): THREE.ShaderMaterial {
  const rng = new Rng(seed);
  const offset = new THREE.Vector3(rng.range(-50, 50), rng.range(-50, 50), rng.range(-50, 50));
  const spotLon = rng.range(0, Math.PI * 2);
  const spotLat = rng.range(-0.45, 0.45);
  return new THREE.ShaderMaterial({
    uniforms: {
      uKind: { value: look.kind },
      uOctaves: { value: octaves },
      uSea: { value: look.seaLevel },
      uDeep: { value: linear(look.deep) },
      uShallow: { value: linear(look.shallow) },
      uSand: { value: linear(look.sand) },
      uLow: { value: linear(look.low) },
      uLow2: { value: linear(look.low2) },
      uHigh: { value: linear(look.high) },
      uPeak: { value: linear(look.peak) },
      uIce: { value: look.ice },
      uCity: { value: look.city },
      uEmissive: { value: look.emissive },
      uCracks: { value: look.cracks },
      uBand1: { value: linear(look.bands[0]) },
      uBand2: { value: linear(look.bands[1]) },
      uBand3: { value: linear(look.bands[2]) },
      uScale: { value: look.noiseScale },
      uWarp: { value: look.warp },
      uOffset: { value: offset },
      uSpot: { value: new THREE.Vector3(Math.cos(spotLon), spotLat, Math.sin(spotLon)) },
      uLightPos: { value: new THREE.Vector3(10, 2, 6) },
      uLightColor: { value: new THREE.Color(1, 1, 1) },
      uLightPos2: { value: new THREE.Vector3(-10, 2, 6) },
      uLightColor2: { value: new THREE.Color(0, 0, 0) },
      uTime: { value: 0 },
      uBump: { value: 0.06 },
    },
    vertexShader: SPHERE_VERT,
    fragmentShader: PLANET_FRAG,
  });
}

// ── 구름 ────────────────────────────────────────────────────────────────────
const CLOUD_FRAG = /* glsl */ `
${NOISE_GLSL}
uniform float uCoverage;
uniform vec3 uColor;
uniform vec3 uOffset;
uniform vec3 uLightPos;
uniform vec3 uLightColor;
uniform vec3 uLightPos2;
uniform vec3 uLightColor2;
uniform float uTime;
// 저공비행에서만 쓴다: 멀리 있는 구름은 대기에 묻혀 사라진다. 궤도 화면에서는 0.
uniform float uFogDensity;
uniform vec3 uFogColor;
varying vec3 vObjPos;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
void main() {
  vec3 p = normalize(vObjPos);
  vec3 q = p * 2.4 + uOffset + vec3(uTime * 0.006, 0.0, 0.0);
  q += vec3(snoise(q * 0.8), snoise(q * 0.8 + 7.0), snoise(q * 0.8 + 13.0)) * 0.5;
  float n = fbm(q, 5) * 0.5 + 0.5;
  // 위도 띠를 따라 구름이 늘어서게 한다
  n += sin(p.y * 9.0 + n * 3.0) * 0.06;
  float a = smoothstep(1.0 - uCoverage, 1.0 - uCoverage + 0.22, n);
  a = max(a, step(0.98, uCoverage) * (0.86 + n * 0.14));
  vec3 N = normalize(vWorldNormal);
  vec3 L = normalize(uLightPos - vWorldPos);
  vec3 L2 = normalize(uLightPos2 - vWorldPos);
  vec3 light = uLightColor * smoothstep(-0.12, 0.6, dot(N, L)) + uLightColor2 * smoothstep(-0.12, 0.6, dot(N, L2));
  vec3 col = uColor * (light * 1.05 + 0.01);
  float fd = length(cameraPosition - vWorldPos) * uFogDensity;
  float fog = 1.0 - exp(-fd * fd);
  gl_FragColor = vec4(mix(col, uFogColor, fog), a * 0.92 * (1.0 - fog));
}
`;

export function cloudMaterial(look: PlanetLook, seed: number): THREE.ShaderMaterial {
  const rng = new Rng(seed ^ 0x5bd1e995);
  return new THREE.ShaderMaterial({
    uniforms: {
      uCoverage: { value: look.clouds },
      uColor: { value: linear(look.cloudColor) },
      uOffset: { value: new THREE.Vector3(rng.range(-40, 40), rng.range(-40, 40), rng.range(-40, 40)) },
      uLightPos: { value: new THREE.Vector3(10, 2, 6) },
      uLightColor: { value: new THREE.Color(1, 1, 1) },
      uLightPos2: { value: new THREE.Vector3(-10, 2, 6) },
      uLightColor2: { value: new THREE.Color(0, 0, 0) },
      uTime: { value: 0 },
      uFogDensity: { value: 0 },
      uFogColor: { value: new THREE.Color(0, 0, 0) },
    },
    vertexShader: SPHERE_VERT,
    fragmentShader: CLOUD_FRAG,
    transparent: true,
    depthWrite: false,
  });
}

// ── 대기: 행성 가장자리의 빛 번짐(앞면)과 바깥쪽 후광(뒷면) ─────────────────────
const ATMO_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uStrength;
uniform vec3 uLightPos;
uniform vec3 uLightPos2;
uniform float uHas2;
uniform float uHalo;
varying vec3 vObjPos;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
void main() {
  vec3 N = normalize(vWorldNormal);
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 L = normalize(uLightPos - vWorldPos);
  vec3 L2 = normalize(uLightPos2 - vWorldPos);
  float day = max(smoothstep(-0.35, 0.45, dot(N, L)), uHas2 * smoothstep(-0.35, 0.45, dot(N, L2)));
  float d = dot(N, V);
  float glow;
  if (uHalo > 0.5) {
    glow = pow(smoothstep(0.0, 0.42, -d), 2.2);
  } else {
    glow = pow(1.0 - max(d, 0.0), 3.5);
  }
  gl_FragColor = vec4(uColor * uStrength, glow * day);
}
`;

export function atmosphereMaterial(look: PlanetLook, halo: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: linear(look.atmosphere) },
      uStrength: { value: look.atmosphereStrength * (halo ? 1.1 : 0.9) },
      uLightPos: { value: new THREE.Vector3(10, 2, 6) },
      uLightPos2: { value: new THREE.Vector3(-10, 2, 6) },
      uHas2: { value: 0 },
      uHalo: { value: halo ? 1 : 0 },
    },
    vertexShader: SPHERE_VERT,
    fragmentShader: ATMO_FRAG,
    transparent: true,
    depthWrite: false,
    side: halo ? THREE.BackSide : THREE.FrontSide,
    blending: THREE.AdditiveBlending,
  });
}

// ── 고리 ────────────────────────────────────────────────────────────────────
const RING_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vLocal;
void main() {
  vUv = uv;
  vLocal = position;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const RING_FRAG = /* glsl */ `
${NOISE_GLSL}
uniform vec3 uColor;
uniform float uInner;
uniform float uOuter;
uniform float uSeed;
uniform vec3 uLightColor;
uniform vec3 uLightColor2;
varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vLocal;
void main() {
  float r = length(vLocal.xy);
  float t = (r - uInner) / (uOuter - uInner);
  float bands = snoise(vec3(t * 38.0, uSeed, 0.0)) * 0.5 + 0.5;
  bands *= 0.6 + 0.4 * (snoise(vec3(t * 140.0, uSeed + 3.0, 0.0)) * 0.5 + 0.5);
  float edge = smoothstep(0.0, 0.06, t) * smoothstep(1.0, 0.9, t);
  float gap = 1.0 - smoothstep(0.015, 0.0, abs(t - 0.62)) * 0.9;
  float a = bands * edge * gap * 0.85;
  gl_FragColor = vec4(uColor * (uLightColor + uLightColor2) * (0.35 + bands * 0.75), a);
}
`;

export function ringMaterial(color: string, inner: number, outer: number, seed: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: linear(color) },
      uInner: { value: inner },
      uOuter: { value: outer },
      uSeed: { value: (seed % 1000) / 10 },
      uLightColor: { value: new THREE.Color(1, 1, 1) },
      uLightColor2: { value: new THREE.Color(0, 0, 0) },
    },
    vertexShader: RING_VERT,
    fragmentShader: RING_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}
