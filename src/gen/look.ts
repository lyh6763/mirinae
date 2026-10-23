import type { Rng } from './rng';
import type { Atmosphere, LifeLevel, PlanetType } from './system';

/** 행성 셰이더에 넘길 겉모습 값. 색은 sRGB 16진수로 두고 렌더러에서 선형으로 바꾼다. */
export interface PlanetLook {
  /** 0 지형 · 1 가스 띠 · 2 용암 */
  kind: 0 | 1 | 2;
  /** 높이 공간(대략 -0.7~0.7)의 해수면. 바다가 없으면 -2 */
  seaLevel: number;
  deep: string;
  shallow: string;
  sand: string;
  low: string;
  low2: string;
  high: string;
  peak: string;
  ice: number;
  clouds: number;
  cloudColor: string;
  atmosphere: string;
  atmosphereStrength: number;
  emissive: number;
  /** 얼음 표면의 갈라진 틈 (0~1) */
  cracks: number;
  city: number;
  bands: [string, string, string];
  noiseScale: number;
  warp: number;
  ringColor: string;
}

interface Context {
  ocean: number;
  life: LifeLevel;
  atmosphere: Atmosphere;
  tempC: number;
}

const BASE: PlanetLook = {
  kind: 0, seaLevel: -2,
  deep: '#0b2a4a', shallow: '#1f6a8a', sand: '#c9b98a', low: '#3f6b2f', low2: '#8a8a45', high: '#6b5a45', peak: '#e8e8e8',
  ice: 0, clouds: 0, cloudColor: '#ffffff', atmosphere: '#6aa8ff', atmosphereStrength: 0, emissive: 0, cracks: 0, city: 0,
  bands: ['#d9c2a0', '#b07a4f', '#f0e4cf'], noiseScale: 1.6, warp: 0.6, ringColor: '#cbbd9e',
};

// 외계 식생은 꼭 초록일 필요가 없다.
const VEGETATION = [
  ['#3f6b2f', '#7d8a45'], ['#2f5f3a', '#6f7d40'], ['#5b3a6e', '#8a6a7a'],
  ['#7a3b2a', '#9a7a4a'], ['#2f6b5f', '#7a8a5a'], ['#6b6b2a', '#a08a4a'],
] as const;

const GAS_BANDS: [string, string, string][] = [
  ['#d9c2a0', '#b07a4f', '#f0e4cf'],
  ['#e3cf9a', '#c7a868', '#f3e7c4'],
  ['#7fb4c9', '#3f6f8f', '#cfe8ef'],
  ['#d8a0b0', '#9a5f7a', '#f2d6dc'],
  ['#c9a27a', '#6f4a3a', '#efd9b8'],
];
const ICE_GIANT_BANDS: [string, string, string][] = [
  ['#8fd0e0', '#5fa8c8', '#b8e8f0'],
  ['#5a7fe0', '#3d5ab8', '#8fa8f0'],
  ['#7fe0c8', '#4fa898', '#c0f0e4'],
];

function seaFromOcean(ocean: number): number {
  if (ocean <= 0.01) return -2;
  if (ocean >= 0.985) return 0.75;
  return (ocean - 0.5) * 0.62;
}

export function lookFor(rng: Rng, type: PlanetType, ctx: Context): PlanetLook {
  const look: PlanetLook = { ...BASE, noiseScale: rng.range(1.2, 2.2), warp: rng.range(0.3, 1.0) };
  const atmo = ctx.atmosphere;

  if (atmo === 'sulfur') {
    look.clouds = 1;
    look.cloudColor = '#e6d38f';
  } else if (atmo === 'thickCO2') {
    look.clouds = rng.range(0.75, 0.95);
    look.cloudColor = '#d9c3a0';
  }

  switch (type) {
    case 'terran': {
      const [veg, dry] = ctx.life >= 2 ? rng.pick(VEGETATION) : ctx.life === 1 ? ['#5d6a4a', '#8a7f5a'] : ['#6d6150', '#8f8068'];
      Object.assign(look, {
        seaLevel: seaFromOcean(ctx.ocean), low: veg, low2: dry,
        ice: ctx.tempC < 25 ? rng.range(0.12, 0.4) : rng.range(0, 0.1),
        clouds: look.clouds || rng.range(0.4, 0.7),
        atmosphere: '#6aa8ff', atmosphereStrength: 1,
        city: ctx.life === 3 ? 1 : 0,
      });
      break;
    }
    case 'ocean':
      Object.assign(look, {
        seaLevel: seaFromOcean(ctx.ocean), deep: '#06213f', shallow: '#1a5f8f', sand: '#a8c4c8',
        low: ctx.life >= 2 ? '#2f6b4a' : '#5a6a5a', low2: '#7a8a6a',
        ice: ctx.tempC < 10 ? rng.range(0.15, 0.35) : 0,
        clouds: look.clouds || rng.range(0.55, 0.85),
        atmosphere: '#7fb8ff', atmosphereStrength: 1.1, city: ctx.life === 3 ? 1 : 0,
      });
      break;
    case 'desert': {
      const red = rng.chance(0.5);
      Object.assign(look, {
        seaLevel: seaFromOcean(ctx.ocean), deep: '#3a4a3a', shallow: '#5f7a6a',
        sand: red ? '#c8784a' : '#dcc49a', low: red ? '#b0603a' : '#c8a878', low2: red ? '#8a4a30' : '#a88a60',
        high: red ? '#6e3a28' : '#8a6a48', peak: red ? '#d8b8a0' : '#efe2c8',
        ice: ctx.tempC < -20 ? rng.range(0.1, 0.25) : 0,
        clouds: look.clouds || rng.range(0, 0.12),
        atmosphere: red ? '#ffa070' : '#ffd8a0', atmosphereStrength: atmo === 'thinCO2' ? 0.4 : 0.8,
      });
      break;
    }
    case 'rocky': {
      const tone = rng.pick([['#8a8580', '#6e6a66', '#5a5450', '#8f8a84', '#c0bab2'], ['#7a6a5a', '#5f5246', '#4a4038', '#8a7a6a', '#b8a898']]);
      Object.assign(look, {
        sand: tone[0], low: tone[1], low2: tone[2], high: tone[3], peak: tone[4],
        noiseScale: rng.range(2, 3.2), warp: rng.range(0.1, 0.4),
        atmosphere: '#b8c0d0', atmosphereStrength: atmo === 'none' ? 0 : 0.35,
      });
      break;
    }
    case 'lava':
      Object.assign(look, {
        kind: 2, low: '#1a1414', low2: '#2b1f1c', high: '#3a2a24', peak: '#4a3a32',
        emissive: rng.range(0.9, 1.6), noiseScale: rng.range(1.6, 2.6),
        atmosphere: '#ff6a3a', atmosphereStrength: atmo === 'none' ? 0.15 : 0.7,
        clouds: atmo === 'none' ? 0 : look.clouds * 0.5, cloudColor: '#5a4038',
      });
      break;
    case 'ice':
      Object.assign(look, {
        sand: '#cfe3ee', low: '#bcd6e6', low2: '#a9c7da', high: '#e8f4fa', peak: '#ffffff',
        deep: '#3a5f80', shallow: '#6a8fb0', ice: 0, cracks: 1,
        clouds: atmo === 'methane' ? 0.5 : 0, cloudColor: atmo === 'methane' ? '#d8b46a' : '#ffffff',
        atmosphere: atmo === 'methane' ? '#d8a050' : '#cfe8ff',
        atmosphereStrength: atmo === 'methane' ? 1 : atmo === 'none' ? 0 : 0.3,
      });
      break;
    case 'gas':
      Object.assign(look, {
        kind: 1, bands: rng.pick(GAS_BANDS), atmosphere: '#f0d8b0', atmosphereStrength: 0.7,
        noiseScale: rng.range(5, 11), warp: rng.range(0.4, 1.2), ringColor: rng.pick(['#cbbd9e', '#b8a888', '#9a9088']),
      });
      look.atmosphere = look.bands[2];
      break;
    case 'icegiant':
      Object.assign(look, {
        kind: 1, bands: rng.pick(ICE_GIANT_BANDS), atmosphereStrength: 0.9,
        noiseScale: rng.range(3, 6), warp: rng.range(0.2, 0.6), ringColor: '#9fb0c0',
      });
      look.atmosphere = look.bands[2];
      break;
  }
  return look;
}
