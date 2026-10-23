import { LY_PER_UNIT, SPECTRAL_CLASSES, SPECTRAL_LOOK, starPosition, type Galaxy, type SpectralClass } from './galaxy';
import { planetName, sectorOf, starName, type Sector } from './names';
import { lookFor, type PlanetLook } from './look';
import { hash32, Rng, type Weighted } from './rng';

export type PlanetType = 'lava' | 'rocky' | 'desert' | 'terran' | 'ocean' | 'ice' | 'gas' | 'icegiant';

export const PLANET_TYPE_LABEL: Record<PlanetType, string> = {
  lava: '용암 행성',
  rocky: '암석 행성',
  desert: '사막 행성',
  terran: '지구형 행성',
  ocean: '바다 행성',
  ice: '얼음 행성',
  gas: '가스 거인',
  icegiant: '얼음 거인',
};

/** 0 없음 · 1 미생물 · 2 복잡한 생태계 · 3 문명 */
export type LifeLevel = 0 | 1 | 2 | 3;
export const LIFE_LABEL = ['생명 흔적 없음', '미생물', '복잡한 생태계', '문명 신호'] as const;

export type Atmosphere =
  | 'none' | 'thinCO2' | 'thickCO2' | 'sulfur' | 'nitrogen' | 'oxygen' | 'steam' | 'methane' | 'hydrogen';

export const ATMOSPHERE_LABEL: Record<Atmosphere, string> = {
  none: '대기 없음',
  thinCO2: '옅은 이산화탄소',
  thickCO2: '짙은 이산화탄소',
  sulfur: '황산 구름',
  nitrogen: '질소·이산화탄소',
  oxygen: '질소·산소',
  steam: '질소·수증기',
  methane: '질소·메탄 안개',
  hydrogen: '수소·헬륨',
};

export const CIV_SIGNALS = ['주기적인 전파 신호', '밤 쪽의 도시 불빛', '궤도를 도는 인공 구조물', '레이저 통신 섬광'] as const;

export type StarKind = 'single' | 'binary' | 'hole' | 'core';

/** 쌍성의 동반성. 두 별이 가까이 돌고, 행성은 둘을 함께 돈다(쌍성 주위 궤도). */
export interface Companion {
  cls: SpectralClass;
  color: string;
  temperatureK: number;
  mass: number;
  radius: number;
  luminosity: number;
  separationAU: number;
  periodDays: number;
}

export interface BlackHole {
  massSun: number;
  /** 사건의 지평선(슈바르츠실트) 반지름 */
  horizonKm: number;
  /** 강착원반 안쪽 가장자리 온도 */
  diskTempK: number;
}

export interface Star {
  index: number;
  seed: number;
  kind: StarKind;
  name: string;
  code: string;
  cls: SpectralClass;
  color: string;
  temperatureK: number;
  mass: number;
  radius: number;
  luminosity: number;
  ageGyr: number;
  /** 쌍성이면 두 별을 합친 밝기 기준 */
  habitable: [number, number];
  snowLine: number;
  sector: Sector;
  coreDistanceLy: number;
  companion: Companion | null;
  hole: BlackHole | null;
}

export interface Planet {
  order: number;
  seed: number;
  name: string;
  type: PlanetType;
  orbitAU: number;
  periodDays: number;
  radiusEarth: number;
  massEarth: number;
  gravity: number;
  tempC: number;
  atmosphere: Atmosphere;
  pressure: number;
  ocean: number;
  life: LifeLevel;
  civSignal: string | null;
  moons: number;
  rings: boolean;
  dayHours: number | null;
  tilt: number;
  inHabitableZone: boolean;
  look: PlanetLook;
}

export interface StarSystem {
  star: Star;
  planets: Planet[];
}

// 주계열성 기준 대략값. t 하나로 온도·질량·반지름을 함께 움직여 앞뒤가 맞게 한다.
const CLASS_RANGE: Record<SpectralClass, { t: [number, number]; m: [number, number]; r: [number, number]; age: [number, number] }> = {
  O: { t: [30000, 45000], m: [16, 60], r: [6.6, 15], age: [0.001, 0.01] },
  B: { t: [10000, 30000], m: [2.1, 16], r: [1.8, 6.6], age: [0.01, 0.3] },
  A: { t: [7500, 10000], m: [1.4, 2.1], r: [1.4, 1.8], age: [0.1, 1.5] },
  F: { t: [6000, 7500], m: [1.04, 1.4], r: [1.15, 1.4], age: [0.5, 5] },
  G: { t: [5200, 6000], m: [0.8, 1.04], r: [0.96, 1.15], age: [1, 10] },
  K: { t: [3700, 5200], m: [0.45, 0.8], r: [0.7, 0.96], age: [1, 12] },
  M: { t: [2400, 3700], m: [0.08, 0.45], r: [0.1, 0.7], age: [1, 13] },
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const KIND_NAMES: StarKind[] = ['single', 'binary', 'hole', 'core'];

/** 같은 분광형 안에서 t(0~1) 하나로 온도·질량·반지름·밝기를 함께 정한다. */
function mainSequence(cls: SpectralClass, t: number) {
  const range = CLASS_RANGE[cls];
  const temperatureK = Math.round(lerp(range.t[0], range.t[1], t) / 10) * 10;
  const radius = lerp(range.r[0], range.r[1], t);
  return {
    temperatureK,
    mass: lerp(range.m[0], range.m[1], t),
    radius,
    luminosity: radius * radius * Math.pow(temperatureK / 5778, 4),
  };
}

export function makeStar(galaxy: Galaxy, index: number): Star {
  const seed = hash32(galaxy.seed, index, 7);
  const rng = new Rng(seed);
  const kind = KIND_NAMES[galaxy.kinds[index]] ?? 'single';
  const cls = SPECTRAL_CLASSES[galaxy.classes[index]];
  const range = CLASS_RANGE[cls];
  const main = mainSequence(cls, rng.next());
  const ageGyr = lerp(range.age[0], range.age[1], rng.next());
  const [x, y, z] = starPosition(galaxy, index);
  const sector = sectorOf(x, z);
  const extra = new Rng(hash32(seed, 13));

  // 동반성은 주성과 같거나 더 차갑다. 둘은 행성 궤도보다 훨씬 가까이 돈다.
  let companion: Companion | null = null;
  if (kind === 'binary') {
    const cIndex = Math.min(6, galaxy.classes[index] + extra.int(0, 2));
    const cCls = SPECTRAL_CLASSES[cIndex];
    const c = mainSequence(cCls, extra.next() * (cIndex === galaxy.classes[index] ? 0.9 : 1));
    const total = main.mass + c.mass;
    const separationAU = extra.range(0.04, 0.22) * Math.cbrt(total);
    companion = {
      cls: cCls, color: SPECTRAL_LOOK[cCls].color, ...c, separationAU,
      periodDays: 365.25 * Math.sqrt(separationAU ** 3 / total),
    };
  }

  let hole: BlackHole | null = null;
  if (kind === 'hole' || kind === 'core') {
    const massSun = kind === 'core' ? Math.pow(10, extra.range(5.8, 7.3)) : extra.range(5, 28);
    hole = {
      massSun,
      horizonKm: 2.95 * massSun,
      // 작은 블랙홀일수록 원반이 뜨겁다(엑스선). 초대질량은 자외선 정도.
      diskTempK: kind === 'core' ? Math.round(extra.range(6e4, 2.5e5)) : Math.round(extra.range(5e6, 2e7)),
    };
  }

  const luminosity = hole ? 0 : main.luminosity + (companion?.luminosity ?? 0);
  return {
    index,
    seed,
    kind,
    name: kind === 'core' ? `${galaxy.name}의 심장` : starName(new Rng(hash32(seed, 11))),
    code: `MRN-${String(sector.index + 1).padStart(2, '0')}-${String(index).padStart(6, '0')}`,
    cls,
    color: hole ? '#d9c8ff' : SPECTRAL_LOOK[cls].color,
    temperatureK: main.temperatureK,
    mass: hole ? hole.massSun : main.mass,
    radius: main.radius,
    luminosity: hole ? 0 : main.luminosity,
    ageGyr: kind === 'core' ? 12 + extra.next() : ageGyr,
    habitable: [Math.sqrt(luminosity / 1.1), Math.sqrt(luminosity / 0.53)],
    snowLine: 2.7 * Math.sqrt(luminosity),
    sector,
    coreDistanceLy: Math.round(Math.hypot(x, y, z) * LY_PER_UNIT),
    companion,
    hole,
  };
}

/** 쌍성은 두 별의 밝기를 합친다. 블랙홀은 0. */
export function totalLuminosity(star: Star): number {
  return star.luminosity + (star.companion?.luminosity ?? 0);
}

const PLANET_COUNT: Weighted<number> = [[0, 3], [1, 5], [2, 8], [3, 10], [4, 10], [5, 9], [6, 7], [7, 5], [8, 3], [9, 2]];

function choosePlanetType(rng: Rng, star: Star, a: number, tEq: number): PlanetType {
  const [hzIn, hzOut] = star.habitable;
  if (a > star.snowLine) {
    const far = a / star.snowLine;
    return rng.weighted([['gas', far < 3 ? 55 : 30], ['icegiant', far < 3 ? 22 : 40], ['ice', 23]] as const);
  }
  if (a > star.snowLine * 0.5 && rng.chance(0.12)) return 'gas';
  if (tEq > 700) return rng.chance(0.06) ? 'gas' : rng.chance(0.72) ? 'lava' : 'rocky';
  if (a >= hzIn && a <= hzOut) {
    return rng.weighted([['terran', 40], ['ocean', 24], ['desert', 20], ['rocky', 16]] as const);
  }
  if (a < hzIn) {
    return rng.weighted([['desert', 45], ['rocky', 40], ['lava', tEq > 500 ? 15 : 3]] as const);
  }
  return rng.weighted([['rocky', 35], ['ice', 45], ['desert', 20]] as const);
}

const RADIUS_RANGE: Record<PlanetType, [number, number]> = {
  lava: [0.4, 1.6], rocky: [0.3, 1.5], desert: [0.5, 1.8], terran: [0.75, 1.6],
  ocean: [0.9, 2.2], ice: [0.3, 1.4], gas: [6, 14], icegiant: [3, 5.5],
};

function chooseAtmosphere(rng: Rng, type: PlanetType, life: boolean): Atmosphere {
  switch (type) {
    case 'lava': return rng.weighted([['none', 50], ['thickCO2', 20], ['sulfur', 15], ['thinCO2', 15]] as const);
    case 'rocky': return rng.weighted([['none', 50], ['thinCO2', 35], ['nitrogen', 15]] as const);
    case 'desert': return rng.weighted([['thinCO2', 45], ['nitrogen', 25], ['thickCO2', 18], ['sulfur', 12]] as const);
    case 'terran': return life ? 'oxygen' : rng.weighted([['nitrogen', 70], ['oxygen', 10], ['thickCO2', 20]] as const);
    case 'ocean': return life && rng.chance(0.6) ? 'oxygen' : 'steam';
    case 'ice': return rng.weighted([['none', 55], ['methane', 30], ['thinCO2', 15]] as const);
    case 'gas':
    case 'icegiant': return 'hydrogen';
  }
}

const GREENHOUSE: Record<Atmosphere, [number, number]> = {
  none: [0, 0], thinCO2: [3, 12], thickCO2: [120, 420], sulfur: [180, 460], nitrogen: [10, 30],
  oxygen: [18, 38], steam: [25, 60], methane: [8, 20], hydrogen: [0, 0],
};

const PRESSURE: Record<Atmosphere, [number, number]> = {
  none: [0, 0], thinCO2: [0.004, 0.05], thickCO2: [20, 95], sulfur: [40, 110], nitrogen: [0.4, 3],
  oxygen: [0.6, 2.2], steam: [1, 6], methane: [1, 1.6], hydrogen: [0, 0],
};

function lifeLevel(rng: Rng, star: Star, type: PlanetType, hz: boolean, tempC: number): LifeLevel {
  // 뜨겁고 짧게 사는 별 곁에서는 생명이 자랄 시간이 없다.
  if (star.cls === 'O' || star.cls === 'B' || star.ageGyr < 0.5) return 0;
  const liquid = tempC > -15 && tempC < 70;
  let odds: Weighted<LifeLevel>;
  if ((type === 'terran' || type === 'ocean') && hz && liquid) {
    odds = type === 'terran' ? [[0, 25], [1, 40], [2, 30], [3, 5]] : [[0, 35], [1, 40], [2, 22], [3, 3]];
  } else if (type === 'desert' && hz) {
    odds = [[0, 70], [1, 28], [2, 2]];
  } else if (type === 'ice') {
    odds = [[0, 92], [1, 8]];
  } else {
    return 0;
  }
  let level = rng.weighted(odds);
  if (level >= 2 && star.ageGyr < 1.5) level = 1;
  if (level === 3 && star.ageGyr < 3) level = 2;
  // 적색왜성의 잦은 플레어는 복잡한 생명을 어렵게 한다.
  if (level >= 2 && star.cls === 'M' && rng.chance(0.5)) level = 1;
  return level;
}

export function makeSystem(galaxy: Galaxy, index: number): StarSystem {
  const star = makeStar(galaxy, index);
  // 블랙홀 곁에는 행성을 두지 않는다.
  if (star.hole) return { star, planets: [] };
  const rng = new Rng(hash32(star.seed, 23));
  let count = rng.weighted(PLANET_COUNT);
  if (star.cls === 'O' || star.cls === 'B') count = Math.floor(count * 0.5);
  const L = totalLuminosity(star);
  const mass = star.mass + (star.companion?.mass ?? 0);

  const planets: Planet[] = [];
  let a = Math.max(0.012, star.habitable[0] * rng.range(0.28, 0.75));
  // 쌍성 주위를 도는 행성은 두 별 사이 거리의 3배보다 멀어야 궤도가 안정하다.
  if (star.companion) a = Math.max(a, star.companion.separationAU * 3.2);
  const spacing = rng.range(1.45, 1.95);

  for (let order = 0; order < count; order++) {
    const seed = hash32(star.seed, 101, order);
    const p = new Rng(seed);
    const tEq = 279 * Math.pow(L, 0.25) / Math.sqrt(a) * Math.pow(0.7, 0.25);
    const type = choosePlanetType(p, star, a, tEq);
    const [rMin, rMax] = RADIUS_RANGE[type];
    const radiusEarth = lerp(rMin, rMax, p.next());
    const giant = type === 'gas' || type === 'icegiant';
    const massEarth = giant
      ? type === 'gas' ? lerp(40, 420, p.next()) : lerp(9, 26, p.next())
      : Math.pow(radiusEarth, 3.4) * lerp(0.8, 1.15, p.next());
    const hz = a >= star.habitable[0] && a <= star.habitable[1];

    // 생명 판정은 기온에 달려 있고, 기온은 대기에 달려 있다. 생명이 있으면 산소 대기를 준다.
    const lifeRoll = new Rng(hash32(seed, 5));
    const lifeHint = (type === 'terran' || type === 'ocean') && hz && lifeRoll.chance(0.75);
    const atmosphere = chooseAtmosphere(p, type, lifeHint);
    const [gMin, gMax] = GREENHOUSE[atmosphere];
    const tempC = Math.round(tEq + lerp(gMin, gMax, p.next()) - 273);
    const life = lifeLevel(lifeRoll, star, type, hz, tempC);
    const [pMin, pMax] = PRESSURE[atmosphere];

    const ocean = type === 'ocean' ? lerp(0.92, 1, p.next())
      : type === 'terran' ? lerp(0.3, 0.85, p.next())
      : type === 'desert' ? lerp(0, 0.08, p.next())
      : 0;

    // 별에 바짝 붙은 행성은 한쪽 면만 별을 본다(조석 고정).
    const locked = a < star.habitable[0] * 0.5 || (star.cls === 'M' && a < star.habitable[1]);

    planets.push({
      order,
      seed,
      name: planetName(star.name, order),
      type,
      orbitAU: a,
      periodDays: 365.25 * Math.sqrt((a * a * a) / mass),
      radiusEarth,
      massEarth,
      gravity: massEarth / (radiusEarth * radiusEarth),
      tempC,
      atmosphere,
      pressure: lerp(pMin, pMax, p.next()),
      ocean,
      life,
      civSignal: life === 3 ? p.pick(CIV_SIGNALS) : null,
      moons: giant ? p.int(2, 34) : p.weighted([[0, 5], [1, 3], [2, 2], [3, 1]] as const),
      rings: giant ? p.chance(type === 'gas' ? 0.38 : 0.25) : p.chance(0.03),
      dayHours: locked ? null : lerp(8, giant ? 20 : 60, p.next()),
      tilt: p.chance(0.06) ? lerp(60, 98, p.next()) : lerp(0, 35, p.next()),
      inHabitableZone: hz,
      look: lookFor(new Rng(hash32(seed, 9)), type, { ocean, life, atmosphere, tempC }),
    });

    a *= spacing * (1 + p.gauss() * 0.06);
  }

  return { star, planets };
}

/** 이 별의 계에 문명이 있는지만 빨리 본다. 은하 전체 신호 탐색용. */
export function hasCivilization(system: StarSystem): Planet | undefined {
  return system.planets.find((p) => p.life === 3);
}
