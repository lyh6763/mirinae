import * as THREE from 'three';

// 은하를 이루는 별 점. 멀어질수록 작아지되, 1픽셀 아래로는 크기 대신 밝기를 줄인다.
const STAR_VERT = /* glsl */ `
attribute float aSize;
attribute vec3 aColor;
uniform float uScale;
uniform float uPixelRatio;
uniform float uMaxSize;
varying vec3 vColor;
varying float vFade;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float px = aSize * uScale / max(-mv.z, 0.001);
  vFade = clamp(px / 2.8, 0.03, 1.0);
  gl_PointSize = clamp(px, 1.4, uMaxSize) * uPixelRatio;
  vColor = aColor;
  gl_Position = projectionMatrix * mv;
}
`;

const STAR_FRAG = /* glsl */ `
uniform float uBoost;
varying vec3 vColor;
varying float vFade;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  float core = exp(-d * d * 9.0);
  float halo = exp(-d * 3.2) * 0.3;
  gl_FragColor = vec4(vColor * uBoost, (core + halo) * vFade);
}
`;

export function starPointsMaterial(pixelRatio: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uScale: { value: 1500 },
      uPixelRatio: { value: pixelRatio },
      uMaxSize: { value: 14 },
      uBoost: { value: 1.25 },
    },
    vertexShader: STAR_VERT,
    fragmentShader: STAR_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

// 성운: 크고 흐린 빛무리. 카메라에 가까우면 사라지게 해 화면이 뿌옇게 덮이지 않게 한다.
const NEBULA_VERT = /* glsl */ `
attribute float aSize;
attribute vec3 aColor;
uniform float uScale;
uniform float uPixelRatio;
varying vec3 vColor;
varying float vFade;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float dist = max(-mv.z, 0.001);
  float px = aSize * uScale / dist;
  vFade = smoothstep(20.0, 160.0, dist) * (1.0 - smoothstep(180.0, 260.0, px));
  gl_PointSize = min(px, 260.0) * uPixelRatio;
  vColor = aColor;
  gl_Position = projectionMatrix * mv;
}
`;

const NEBULA_FRAG = /* glsl */ `
uniform float uIntensity;
varying vec3 vColor;
varying float vFade;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  float a = exp(-d * d * 3.5) * (1.0 - d);
  gl_FragColor = vec4(vColor, a * uIntensity * vFade);
}
`;

export function nebulaMaterial(pixelRatio: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uScale: { value: 1500 },
      uPixelRatio: { value: pixelRatio },
      uIntensity: { value: 0.07 },
    },
    vertexShader: NEBULA_VERT,
    fragmentShader: NEBULA_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

// 먼지띠: 뒤에 있는 빛을 깎아 내는 어두운 구름. 대상 색에 (1 - 알파)를 곱한다.
const DUST_FRAG = /* glsl */ `
uniform float uIntensity;
varying vec3 vColor;
varying float vFade;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  float a = exp(-d * d * 3.0) * (1.0 - d);
  gl_FragColor = vec4(0.0, 0.0, 0.0, a * uIntensity * vFade);
}
`;

export function dustMaterial(pixelRatio: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uScale: { value: 1500 },
      uPixelRatio: { value: pixelRatio },
      uIntensity: { value: 0.32 },
    },
    vertexShader: NEBULA_VERT,
    fragmentShader: DUST_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.ZeroFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
  });
}

// 항성계·행성 화면의 하늘. 은하의 모든 별을 '그 별에서 본 방향'으로 하늘 구에 찍는다.
// 원반 방향으로 별이 몰려 있으니 하늘에 은하수 띠가 저절로 생긴다.
const SKY_VERT = /* glsl */ `
attribute float aSize;
attribute vec3 aColor;
uniform vec3 uOrigin;
uniform float uPixelRatio;
uniform float uGain;
uniform float uMaxPx;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec3 rel = position - uOrigin;
  float dist = length(rel);
  vec3 dir = rel / max(dist, 0.0001);
  vec4 mv = viewMatrix * vec4(cameraPosition + dir * 5000.0, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_Position.z = gl_Position.w * 0.99999;
  float b = aSize * uGain / (dist + 1.5);
  vAlpha = clamp(b, 0.035, 1.0);
  gl_PointSize = clamp(b * 1.6, 1.0, uMaxPx) * uPixelRatio;
  vColor = aColor;
  // 자기 자신은 찍지 않는다.
  if (dist < 0.001) gl_PointSize = 0.0;
}
`;

const SKY_FRAG = /* glsl */ `
uniform float uFade;
varying vec3 vColor;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  float a = exp(-d * d * 6.0);
  gl_FragColor = vec4(vColor * 1.3, a * vAlpha * uFade);
}
`;

// 워프 중 별의 빛줄기. 별마다 선분 하나: 머리는 지금 위치에서 본 방향, 꼬리는 조금 전 위치에서 본 방향.
// 가까운 별일수록 방향이 크게 바뀌니 길게 끌리고, 먼 별은 점처럼 남는다.
const STREAK_VERT = /* glsl */ `
attribute float aEnd;
attribute float aSize;
attribute vec3 aColor;
uniform vec3 uHead;
uniform vec3 uTail;
uniform float uGain;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec3 o = mix(uHead, uTail, aEnd);
  vec3 rel = position - o;
  vec3 dir = rel / max(length(rel), 0.0001);
  vec4 mv = viewMatrix * vec4(cameraPosition + dir * 5000.0, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_Position.z = gl_Position.w * 0.99999;
  float b = aSize * uGain / (length(position - uHead) + 1.0);
  vAlpha = clamp(b, 0.0, 1.0) * (1.0 - aEnd * 0.85);
  vColor = aColor;
}
`;

const STREAK_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  gl_FragColor = vec4(vColor * 1.6, vAlpha);
}
`;

export function streakMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uHead: { value: new THREE.Vector3() },
      uTail: { value: new THREE.Vector3() },
      uGain: { value: 24 },
    },
    vertexShader: STREAK_VERT,
    fragmentShader: STREAK_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  });
}

export function skyMaterial(pixelRatio: number, origin: THREE.Vector3, gain = 36, maxPx = 4.5): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uOrigin: { value: origin.clone() },
      uPixelRatio: { value: pixelRatio },
      uGain: { value: gain },
      uMaxPx: { value: maxPx },
      // 1이면 그대로. 저공비행의 낮 하늘에서는 대기 밝기만큼 줄인다.
      uFade: { value: 1 },
    },
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    transparent: true,
    depthWrite: false,
    // 하늘 별은 가장 먼 깊이에 찍히므로, 깊이 검사를 켜 두면 앞의 행성·지형에 가려진다.
    // (투명 물체라 불투명 물체보다 나중에 그려지기 때문에, 끄면 행성 위에 별이 덧칠된다.)
    depthTest: true,
    blending: THREE.AdditiveBlending,
  });
}
