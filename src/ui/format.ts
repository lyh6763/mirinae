import type { Planet, PlanetType, Star } from '../gen/system';
import { ATMOSPHERE_LABEL, PLANET_TYPE_LABEL } from '../gen/system';

const nf = new Intl.NumberFormat('ko-KR');

export const num = (n: number) => nf.format(Math.round(n));

/** 큰 수를 '만' 단위로: 32,400 → 3.2만 */
export function man(n: number, digits = 1): string {
  if (n >= 1e8) return `${(n / 1e8).toFixed(digits).replace(/\.0$/, '')}억`;
  if (n >= 1e4) return `${(n / 1e4).toFixed(digits).replace(/\.0$/, '')}만`;
  return num(n);
}

/** 받침 유무에 따라 조사를 고른다: 윤슬 + 이/가 → 윤슬이 */
export function josa(word: string, withFinal: string, withoutFinal: string): string {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  const final = code >= 0 && code < 11172 && code % 28 !== 0;
  return word + (final ? withFinal : withoutFinal);
}

/** 으로/로: 받침이 없거나 ㄹ 받침이면 '로' */
export function ro(word: string): string {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  const jong = code >= 0 && code < 11172 ? code % 28 : 0;
  return word + (jong === 0 || jong === 8 ? '로' : '으로');
}

export const lightYears = (ly: number) => `${man(ly)} 광년`;

/** 태양(또는 지구)의 몇 배인지 */
export function times(x: number): string {
  if (x >= 1e4) return `${man(x)} 배`;
  if (x >= 100) return `${num(x)}배`;
  if (x >= 1) return `${x.toFixed(2).replace(/0$/, '')}배`;
  return `${x.toPrecision(2)}배`;
}

export function age(gyr: number): string {
  const years = gyr * 1e9;
  if (years >= 1e8) return `${(years / 1e8).toFixed(0)}억 년`;
  return `${num(years / 1e4)}만 년`;
}

export function au(a: number): string {
  return `${a < 0.1 ? a.toFixed(3) : a < 10 ? a.toFixed(2) : a.toFixed(1)} AU`;
}

export function period(days: number): string {
  if (days < 2) return `${(days * 24).toFixed(1)}시간`;
  if (days < 800) return `${num(days)}일`;
  return `${(days / 365.25).toFixed(1)}년`;
}

export const tempC = (t: number) => `${t > 0 ? '' : t < 0 ? '−' : ''}${num(Math.abs(t))}℃`;

export const CLASS_LABEL: Record<Star['cls'], string> = {
  O: '청색 초거성급', B: '청백색 별', A: '백색 별', F: '황백색 별', G: '황색 왜성', K: '주황색 왜성', M: '적색 왜성',
};

export const TYPE_COLOR: Record<PlanetType, string> = {
  lava: '#ff7a4a', rocky: '#b3a99c', desert: '#e3a865', terran: '#6fd08a',
  ocean: '#5aa8f0', ice: '#c7ecff', gas: '#e6c896', icegiant: '#86dcec',
};

/** 별 종류를 한 줄로: G형 · 황색 왜성 / G형 + K형 쌍성 / 항성 블랙홀 */
export function kindLabel(star: Star): string {
  if (star.kind === 'core') return '초대질량 블랙홀';
  if (star.kind === 'hole') return '항성 블랙홀';
  if (star.companion) return `${star.cls}형 + ${star.companion.cls}형 쌍성`;
  return `${star.cls}형 · ${CLASS_LABEL[star.cls]}`;
}

/** 블랙홀 소개 */
export function describeHole(star: Star, galaxyName: string): string {
  if (star.kind === 'core') {
    return `은하 ${galaxyName}의 모든 별이 이 보이지 않는 중심을 돕니다. 태양 ${man(star.mass)}개만큼의 질량이 한 점에 모여 있고, 둘레의 원반은 빛을 휘게 해 원반 뒤쪽까지 위아래로 드러냅니다.`;
  }
  return `무거운 별이 다 타고 남긴 블랙홀입니다. 빨려 드는 가스가 수백만 도로 달아오르며 빛나고, 그 빛이 지평선 둘레에서 고리처럼 휘어 보입니다.`;
}

/** 행성을 한두 문장으로 소개한다. */
export function describePlanet(p: Planet, star: Star): string {
  const parts: string[] = [];
  const type = PLANET_TYPE_LABEL[p.type];
  switch (p.type) {
    case 'terran':
      parts.push(`바다가 표면의 ${Math.round(p.ocean * 100)}%를 덮은 ${type}입니다.`);
      break;
    case 'ocean':
      parts.push(`육지가 거의 없이 바다로 뒤덮인 행성입니다.`);
      break;
    case 'desert':
      parts.push(p.ocean > 0.01 ? `마른 땅 사이에 작은 호수가 흩어진 ${type}입니다.` : `물기 없는 모래와 바위의 ${type}입니다.`);
      break;
    case 'lava':
      parts.push(`${star.name}에 바짝 붙어 표면이 녹아 흐르는 행성입니다.`);
      break;
    case 'ice':
      parts.push(p.atmosphere === 'methane' ? `메탄 안개 아래 얼음 평원이 펼쳐진 행성입니다.` : `빛이 거의 닿지 않아 표면이 꽁꽁 언 행성입니다.`);
      break;
    case 'rocky':
      parts.push(p.atmosphere === 'none' ? `대기가 없어 운석 자국이 그대로 남은 암석 행성입니다.` : `옅은 대기에 싸인 메마른 암석 행성입니다.`);
      break;
    case 'gas':
      parts.push(`지구보다 ${Math.round(p.radiusEarth)}배쯤 큰 가스 덩어리로, 단단한 땅이 없습니다.`);
      break;
    case 'icegiant':
      parts.push(`물·암모니아·메탄 얼음이 두꺼운 대기 아래 감춰진 행성입니다.`);
      break;
  }
  if (p.dayHours === null && p.type !== 'gas' && p.type !== 'icegiant') parts.push('한쪽 면만 늘 별을 향해 있습니다.');
  if (p.life === 1) parts.push('표본에서 미생물로 보이는 흔적이 잡혔습니다.');
  if (p.life === 2) parts.push('대기 성분으로 미루어 복잡한 생태계가 있습니다.');
  if (p.life === 3 && p.civSignal) parts.push(`${josa(p.civSignal, '이', '가')} 관측되었습니다. 누군가 살고 있습니다.`);
  return parts.join(' ');
}

export const atmosphere = (p: Planet) => ATMOSPHERE_LABEL[p.atmosphere];

export function pressure(p: Planet): string {
  if (p.atmosphere === 'none') return '—';
  if (p.atmosphere === 'hydrogen') return '바닥 없음';
  return p.pressure < 0.1 ? `${p.pressure.toFixed(3)}기압` : `${p.pressure.toFixed(1)}기압`;
}
