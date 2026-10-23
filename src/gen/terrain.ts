import type { PlanetLook } from './look';
import { Rng } from './rng';

// 셰이더(noise.ts)의 3D 심플렉스 노이즈를 그대로 옮긴 것 — Ian McEwan, Stefan Gustavson (Ashima Arts), MIT License.
// 저공비행 카메라가 GPU가 그리는 지형과 같은 높이를 알아야 해서 CPU에도 둔다.

const mod289 = (x: number) => x - Math.floor(x * (1 / 289)) * 289;
const permute = (x: number) => mod289((x * 34 + 10) * x);
const taylorInvSqrt = (r: number) => 1.79284291400159 - 0.85373472095314 * r;

// 기울기 격자 계산은 GPU의 32비트 실수와 똑같이 반올림해야 한다. 격자 49칸 가운데 여러 칸에서 h가
// 수학적으로 정확히 0이 되는데, 그 반올림 부호에 따라 기울기 방향이 뒤집히기 때문이다.
const F = Math.fround;
const N_ = F(0.142857142857);
const NS_X = F(N_ * 2);
const NS_Y = F(F(N_ * 0.5) - 1);
const NS_Z = N_;

export function snoise(vx: number, vy: number, vz: number): number {
  const s = (vx + vy + vz) / 3;
  let ix = Math.floor(vx + s);
  let iy = Math.floor(vy + s);
  let iz = Math.floor(vz + s);
  const t = (ix + iy + iz) / 6;
  const x0 = [vx - ix + t, vy - iy + t, vz - iz + t];

  // g = step(x0.yzx, x0.xyz), l = 1 - g, i1 = min(g, l.zxy), i2 = max(g, l.zxy)
  const g = [x0[0] >= x0[1] ? 1 : 0, x0[1] >= x0[2] ? 1 : 0, x0[2] >= x0[0] ? 1 : 0];
  const l = [1 - g[0], 1 - g[1], 1 - g[2]];
  const i1 = [Math.min(g[0], l[2]), Math.min(g[1], l[0]), Math.min(g[2], l[1])];
  const i2 = [Math.max(g[0], l[2]), Math.max(g[1], l[0]), Math.max(g[2], l[1])];

  const corners = [
    x0,
    [x0[0] - i1[0] + 1 / 6, x0[1] - i1[1] + 1 / 6, x0[2] - i1[2] + 1 / 6],
    [x0[0] - i2[0] + 1 / 3, x0[1] - i2[1] + 1 / 3, x0[2] - i2[2] + 1 / 3],
    [x0[0] - 0.5, x0[1] - 0.5, x0[2] - 0.5],
  ];
  const offsets = [[0, 0, 0], i1, i2, [1, 1, 1]];

  ix = mod289(ix);
  iy = mod289(iy);
  iz = mod289(iz);

  let sum = 0;
  for (let k = 0; k < 4; k++) {
    const o = offsets[k];
    const p = permute(permute(permute(iz + o[2]) + iy + o[1]) + ix + o[0]);
    const j = p - 49 * Math.floor(p * NS_Z * NS_Z);
    const xg = Math.floor(j * NS_Z);
    const yg = Math.floor(j - 7 * xg);
    // 곱셈·덧셈을 한 번에 반올림(GPU의 FMA와 같다). 두 32비트 수의 곱은 64비트에서 정확하다.
    const x = F(xg * NS_X + NS_Y);
    const y = F(yg * NS_X + NS_Y);
    const h = F(F(1 - Math.abs(x)) - Math.abs(y));
    const sh = h <= 0 ? -1 : 0;
    let gx = x + (Math.floor(x) * 2 + 1) * sh;
    let gy = y + (Math.floor(y) * 2 + 1) * sh;
    let gz = h;
    const norm = taylorInvSqrt(gx * gx + gy * gy + gz * gz);
    gx *= norm;
    gy *= norm;
    gz *= norm;
    const c = corners[k];
    let m = Math.max(0.5 - (c[0] * c[0] + c[1] * c[1] + c[2] * c[2]), 0);
    m *= m;
    sum += m * m * (gx * c[0] + gy * c[1] + gz * c[2]);
  }
  return 105 * sum;
}

function fbm(x: number, y: number, z: number, octaves: number): number {
  let sum = 0;
  let amp = 0.5;
  for (let i = 0; i < octaves; i++) {
    sum += amp * snoise(x, y, z);
    x = x * 2.03 + 1.7;
    y = y * 2.03 + 9.2;
    z = z * 2.03 + 3.1;
    amp *= 0.5;
  }
  return sum;
}

function ridged(x: number, y: number, z: number, octaves: number): number {
  let sum = 0;
  let amp = 0.5;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(snoise(x, y, z));
    sum += amp * n * n;
    x = x * 2.07 + 4.3;
    y = y * 2.07 + 1.1;
    z = z * 2.07 + 7.7;
    amp *= 0.5;
  }
  return sum;
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** planetMaterial이 쓰는 것과 같은 노이즈 오프셋(같은 시드 → 같은 값) */
export function terrainOffset(seed: number): [number, number, number] {
  const rng = new Rng(seed);
  return [rng.range(-50, 50), rng.range(-50, 50), rng.range(-50, 50)];
}

/**
 * 단위 구 위의 방향 (x, y, z)에서 지형 높이(대략 -0.7~0.7). 셰이더의 surfaceHeight와 같은 식이다.
 * 바다가 있으면 해수면 아래는 해수면으로 맞춘다.
 */
export function surfaceHeight(look: PlanetLook, offset: [number, number, number], octaves: number, x: number, y: number, z: number): number {
  const s = look.noiseScale;
  let qx = x * s + offset[0];
  let qy = y * s + offset[1];
  let qz = z * s + offset[2];
  if (look.kind === 2) {
    const w = snoise(qx * 0.5, qy * 0.5, qz * 0.5) * look.warp;
    return fbm(qx + w, qy + w, qz + w, octaves);
  }
  const wx = snoise(qx * 0.55, qy * 0.55, qz * 0.55);
  const wy = snoise(qx * 0.55 + 17.3, qy * 0.55 + 17.3, qz * 0.55 + 17.3);
  const wz = snoise(qx * 0.55 + 41.9, qy * 0.55 + 41.9, qz * 0.55 + 41.9);
  qx += wx * look.warp;
  qy += wy * look.warp;
  qz += wz * look.warp;
  let h = fbm(qx, qy, qz, octaves);
  const ridge = ridged(qx * 1.6 + 3.1, qy * 1.6 + 3.1, qz * 1.6 + 3.1, 4);
  h += (ridge - 0.33) * 0.42 * smoothstep(-0.05, 0.3, h);
  return look.seaLevel > -1.5 ? Math.max(h, look.seaLevel) : h;
}
