import { hash32, Rng, seedFromString, type Weighted } from './rng';

/** 화면 좌표 1단위 = 50광년. 반지름 1000단위 ≈ 5만 광년(우리 은하 원반 반지름 정도). */
export const LY_PER_UNIT = 50;
export const GALAXY_RADIUS = 1000;
export const STAR_COUNT = 160_000;
export const NEBULA_COUNT = 2_600;

export const SPECTRAL_CLASSES = ['O', 'B', 'A', 'F', 'G', 'K', 'M'] as const;
export type SpectralClass = (typeof SPECTRAL_CLASSES)[number];

// 색은 흑체 복사색을 조금 과장했다. 크기는 화면에 찍을 점의 상대 크기.
export const SPECTRAL_LOOK: Record<SpectralClass, { color: string; size: number }> = {
  O: { color: '#8fa8ff', size: 3.4 },
  B: { color: '#a9c1ff', size: 2.7 },
  A: { color: '#d4e0ff', size: 2.1 },
  F: { color: '#fbf8ff', size: 1.7 },
  G: { color: '#ffeccc', size: 1.45 },
  K: { color: '#ffc98f', size: 1.2 },
  M: { color: '#ff9f6b', size: 0.95 },
};

// 실제 은하에서는 M형이 4분의 3이지만, 밝은 별이 눈에 띄는 모습을 살리려 밝은 쪽을 늘렸다.
const FIELD_MIX: Weighted<number> = [[0, 0.25], [1, 2.2], [2, 5], [3, 10], [4, 16], [5, 24], [6, 42]];
// 나선팔 한가운데는 젊고 뜨거운 별이 많고,
const ARM_MIX: Weighted<number> = [[0, 1.4], [1, 9], [2, 12], [3, 14], [4, 15], [5, 20], [6, 28]];
// 팽대부는 늙고 붉은 별이 많다.
const BULGE_MIX: Weighted<number> = [[0, 0], [1, 0.2], [2, 1.2], [3, 5], [4, 16], [5, 34], [6, 44]];

export interface GalaxyShape {
  arms: number;
  /** 나선 감김 정도 = 1 / tan(피치각) */
  winding: number;
  bulgeRadius: number;
  armSpread: number;
  thickness: number;
  rotation: number;
}

/** 별의 종류. 0번 별은 언제나 은하 한가운데의 초대질량 블랙홀이다. */
export const KIND = { single: 0, binary: 1, hole: 2, core: 3 } as const;
export const CORE_INDEX = 0;

export interface Galaxy {
  name: string;
  seed: number;
  shape: GalaxyShape;
  count: number;
  positions: Float32Array;
  colors: Float32Array;
  sizes: Float32Array;
  classes: Uint8Array;
  kinds: Uint8Array;
  nebula: { positions: Float32Array; colors: Float32Array; sizes: Float32Array; count: number };
  dust: { positions: Float32Array; colors: Float32Array; sizes: Float32Array; count: number };
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** sRGB → 선형. 셰이더에 넣는 색은 선형이어야 톤매핑 뒤 원래 색이 나온다. */
function toLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

const CLASS_RGB = SPECTRAL_CLASSES.map((c) => hexToRgb(SPECTRAL_LOOK[c].color).map(toLinear));

export function makeShape(seed: number): GalaxyShape {
  const rng = new Rng(hash32(seed, 1));
  return {
    arms: rng.weighted([[2, 4], [3, 3], [4, 3], [5, 1]] as const),
    winding: rng.range(2.6, 4.4),
    bulgeRadius: GALAXY_RADIUS * rng.range(0.1, 0.17),
    armSpread: rng.range(0.035, 0.06),
    thickness: GALAXY_RADIUS * rng.range(0.016, 0.026),
    rotation: rng.range(0, Math.PI * 2),
  };
}

/** 원반의 지수 분포: 중심에 몰리고 바깥으로 갈수록 엷어진다. */
function discRadius(rng: Rng, scale: number, min: number): number {
  const maxU = 1 - Math.exp(-(GALAXY_RADIUS - min) / scale);
  return min - scale * Math.log(1 - rng.next() * maxU);
}

function armAngle(shape: GalaxyShape, arm: number, r: number): number {
  const r0 = GALAXY_RADIUS * 0.05;
  return shape.rotation + (arm / shape.arms) * Math.PI * 2 + Math.log(Math.max(r, r0) / r0) * shape.winding * 0.42;
}

export function generateGalaxy(name: string, count = STAR_COUNT): Galaxy {
  const seed = seedFromString(name);
  const shape = makeShape(seed);
  const rng = new Rng(hash32(seed, 2));

  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const classes = new Uint8Array(count);

  // 성단 중심. 나선팔을 따라 흩어 놓고 일부 별을 그 주위에 모은다.
  const clusters: [number, number, number][] = [];
  for (let c = 0; c < 420; c++) {
    const r = discRadius(rng, GALAXY_RADIUS * 0.34, shape.bulgeRadius);
    const a = armAngle(shape, rng.int(0, shape.arms - 1), r) + rng.gauss() * 0.12;
    clusters.push([Math.cos(a) * r, rng.gauss() * shape.thickness * 0.5, Math.sin(a) * r]);
  }

  for (let i = 0; i < count; i++) {
    const roll = rng.next();
    let x: number, y: number, z: number;
    let mix = FIELD_MIX;

    if (roll < 0.17) {
      // 팽대부: 살짝 납작한 타원체
      const b = shape.bulgeRadius;
      x = rng.gauss() * b;
      y = rng.gauss() * b * 0.5;
      z = rng.gauss() * b * 0.85;
      mix = BULGE_MIX;
    } else if (roll < 0.8) {
      // 나선팔
      const r = discRadius(rng, GALAXY_RADIUS * 0.36, shape.bulgeRadius * 0.6);
      const a = armAngle(shape, rng.int(0, shape.arms - 1), r);
      const spread = GALAXY_RADIUS * shape.armSpread * (0.5 + r / GALAXY_RADIUS);
      const off = rng.gauss();
      const along = rng.gauss() * 0.4;
      x = Math.cos(a) * r + (Math.cos(a + Math.PI / 2) * off + Math.cos(a) * along) * spread;
      z = Math.sin(a) * r + (Math.sin(a + Math.PI / 2) * off + Math.sin(a) * along) * spread;
      y = rng.gauss() * shape.thickness * (1 - 0.55 * (r / GALAXY_RADIUS));
      if (Math.abs(off) < 0.7) mix = ARM_MIX;
    } else if (roll < 0.9) {
      // 성단
      const [cx, cy, cz] = clusters[rng.int(0, clusters.length - 1)];
      const s = GALAXY_RADIUS * 0.009;
      x = cx + rng.gauss() * s;
      y = cy + rng.gauss() * s * 0.6;
      z = cz + rng.gauss() * s;
      mix = ARM_MIX;
    } else {
      // 팔 사이 원반
      const r = GALAXY_RADIUS * Math.sqrt(rng.next()) * 1.05;
      const a = rng.range(0, Math.PI * 2);
      x = Math.cos(a) * r;
      z = Math.sin(a) * r;
      y = rng.gauss() * shape.thickness * 1.4;
    }

    const cls = rng.weighted(mix);
    const [cr, cg, cb] = CLASS_RGB[cls];
    const bright = 0.75 + rng.next() * 0.5;

    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
    colors[i * 3] = cr * bright;
    colors[i * 3 + 1] = cg * bright;
    colors[i * 3 + 2] = cb * bright;
    sizes[i] = SPECTRAL_LOOK[SPECTRAL_CLASSES[cls]].size * (0.75 + rng.next() * 0.5);
    classes[i] = cls;
  }

  // 별의 종류는 별도 난수 흐름에서 정해, 위치·분광형은 예전과 똑같이 남긴다.
  const kinds = new Uint8Array(count);
  const kindRng = new Rng(hash32(seed, 5));
  const BINARY_ODDS = [0.3, 0.28, 0.22, 0.2, 0.15, 0.13, 0.08];
  const HOLE_RGB = hexToRgb('#d9c8ff').map(toLinear);
  for (let i = 0; i < count; i++) {
    const roll = kindRng.next();
    if (roll < 1 / 2500) {
      kinds[i] = KIND.hole;
      colors.set(HOLE_RGB, i * 3);
      sizes[i] = 2.3;
    } else if (roll < 1 / 2500 + BINARY_ODDS[classes[i]]) {
      kinds[i] = KIND.binary;
      sizes[i] *= 1.15;
    }
  }
  // 은하 중심 블랙홀: 0번 별을 원점으로 옮긴다.
  positions.set([0, 0, 0], CORE_INDEX * 3);
  kinds[CORE_INDEX] = KIND.core;
  colors.set(hexToRgb('#ffe3b8').map(toLinear), CORE_INDEX * 3);
  sizes[CORE_INDEX] = 4;

  return {
    name, seed, shape, count, positions, colors, sizes, classes, kinds,
    nebula: generateNebula(seed, shape),
    dust: generateDust(seed, shape),
  };
}

/** 나선팔 안쪽 가장자리를 따라 늘어선 먼지띠. 빛을 가려 팔의 윤곽을 또렷하게 한다. */
function generateDust(seed: number, shape: GalaxyShape) {
  const rng = new Rng(hash32(seed, 4));
  const count = 3200;
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const r = discRadius(rng, GALAXY_RADIUS * 0.4, shape.bulgeRadius * 1.1);
    const a = armAngle(shape, rng.int(0, shape.arms - 1), r) - 0.16 - Math.abs(rng.gauss()) * 0.05;
    positions[i * 3] = Math.cos(a) * r + rng.gauss() * 8;
    positions[i * 3 + 1] = rng.gauss() * shape.thickness * 0.3;
    positions[i * 3 + 2] = Math.sin(a) * r + rng.gauss() * 8;
    sizes[i] = rng.range(18, 46) * (0.6 + r / GALAXY_RADIUS);
  }
  return { positions, colors: new Float32Array(count * 3), sizes, count };
}

// 성운: 고를 수 없는 장식용 큰 빛무리. 나선팔 안쪽 가장자리를 따라 둔다.
const NEBULA_TINTS = ['#ff4f86', '#ff6f9d', '#6f8dff', '#9b6bff', '#ff8a5c'].map((h) => hexToRgb(h).map(toLinear));

function generateNebula(seed: number, shape: GalaxyShape) {
  const rng = new Rng(hash32(seed, 3));
  const count = NEBULA_COUNT;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const inner = i < count * 0.18;
    const r = inner
      ? Math.abs(rng.gauss()) * shape.bulgeRadius * 0.9
      : discRadius(rng, GALAXY_RADIUS * 0.38, shape.bulgeRadius);
    const a = inner ? rng.range(0, Math.PI * 2) : armAngle(shape, rng.int(0, shape.arms - 1), r) - 0.08 + rng.gauss() * 0.07;
    positions[i * 3] = Math.cos(a) * r + rng.gauss() * 12;
    positions[i * 3 + 1] = rng.gauss() * shape.thickness * 0.5;
    positions[i * 3 + 2] = Math.sin(a) * r + rng.gauss() * 12;
    const tint = inner ? hexToRgb('#ffd9a8').map(toLinear) : rng.pick(NEBULA_TINTS);
    const k = inner ? 0.5 : rng.range(0.25, 0.6);
    colors[i * 3] = tint[0] * k;
    colors[i * 3 + 1] = tint[1] * k;
    colors[i * 3 + 2] = tint[2] * k;
    sizes[i] = inner ? rng.range(60, 140) : rng.range(25, 80);
  }
  return { positions, colors, sizes, count };
}

export function starPosition(galaxy: Galaxy, index: number): [number, number, number] {
  const p = galaxy.positions;
  return [p[index * 3], p[index * 3 + 1], p[index * 3 + 2]];
}
