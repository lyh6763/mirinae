import { Rng, type Weighted } from './rng';

// 한글 음절 = 0xAC00 + (초성 × 21 + 중성) × 28 + 종성
const HANGUL_BASE = 0xac00;

// 된소리는 빼고, 우리말에서 자주 쓰는 소리에 무게를 둔다.
const CHO: Weighted<number> = [
  [0, 8], [2, 8], [3, 7], [5, 7], [6, 8], [7, 6], [9, 8],
  [11, 10], [12, 5], [14, 4], [15, 2], [16, 3], [17, 3], [18, 6],
];
// 첫 음절이 ㄹ로 시작하는 말은 드물다.
const CHO_FIRST: Weighted<number> = CHO.map(([c, w]) => [c, c === 5 ? 1.5 : w] as const);
const JUNG: Weighted<number> = [
  [0, 12], [4, 7], [8, 9], [13, 8], [18, 4], [20, 10], [1, 4], [5, 3],
  [2, 2], [6, 3], [12, 2], [17, 2], [9, 0.8], [14, 0.4], [19, 0.6],
];
const JONG: Weighted<number> = [
  [0, 62], [4, 12], [8, 10], [16, 5], [21, 8], [1, 2], [17, 1],
];

// 순우리말 이름 씨앗. 뜻이 고운 말 위주.
const NATIVE_WORDS = [
  '가람', '미르', '누리', '아라', '하늬', '마루', '다솜', '라온', '윤슬', '노을',
  '가온', '한울', '별하', '은솔', '해솔', '나린', '비채', '온새', '바림', '여울',
  '너울', '도담', '다온', '하람', '그루', '단비', '소담', '아토', '초롱', '타래',
  '한결', '해밀', '늘봄', '별찌', '시울', '물비', '새벽', '이슬', '모래', '미리',
  '가비', '나래', '보라', '샛별', '아리', '여름', '자올', '해나', '희나', '고운',
];

// 우연히 욕설·비속어가 만들어지면 다시 뽑는다.
const BLOCKED = [
  '시발', '씨발', '병신', '지랄', '존나', '좆', '보지', '자지', '섹스', '니미',
  '새끼', '개새', '창녀', '썅', '븅', '등신', '미친', '죽어', '살인', '엿', '년', '놈',
];

function syllable(rng: Rng, first: boolean, allowJong: boolean): string {
  const cho = rng.weighted(first ? CHO_FIRST : CHO);
  const jung = rng.weighted(JUNG);
  const jong = allowJong ? rng.weighted(JONG) : 0;
  return String.fromCharCode(HANGUL_BASE + (cho * 21 + jung) * 28 + jong);
}

function isClean(name: string): boolean {
  return !BLOCKED.some((word) => name.includes(word));
}

function draft(rng: Rng): string {
  const form = rng.next();
  if (form < 0.28) return rng.pick(NATIVE_WORDS);
  if (form < 0.42) return rng.pick(NATIVE_WORDS) + syllable(rng, false, false);
  const length = rng.chance(0.64) ? 2 : 3;
  let out = '';
  for (let i = 0; i < length; i++) out += syllable(rng, i === 0, i < length - 1 || rng.chance(0.4));
  return out;
}

/** 시드에서 별 이름 하나를 만든다. 같은 시드 → 같은 이름. */
export function starName(rng: Rng): string {
  for (let tries = 0; tries < 8; tries++) {
    const name = draft(rng);
    if (isClean(name)) return name;
  }
  return rng.pick(NATIVE_WORDS);
}

/** 행성은 항성 이름 뒤에 천간(갑·을·병…)을 붙여 안쪽부터 차례로 부른다. */
export const HEAVENLY_STEMS = ['갑', '을', '병', '정', '무', '기', '경', '신', '임', '계'] as const;

export function planetName(star: string, order: number): string {
  return `${star} ${HEAVENLY_STEMS[order] ?? String(order + 1)}`;
}

// 동아시아 별자리 구획 28수(宿). 은하 중심에서 본 방위각으로 구역을 나눈다.
export const MANSIONS = [
  ['각', '角'], ['항', '亢'], ['저', '氐'], ['방', '房'], ['심', '心'], ['미', '尾'], ['기', '箕'],
  ['두', '斗'], ['우', '牛'], ['여', '女'], ['허', '虛'], ['위', '危'], ['실', '室'], ['벽', '壁'],
  ['규', '奎'], ['루', '婁'], ['위', '胃'], ['묘', '昴'], ['필', '畢'], ['자', '觜'], ['삼', '參'],
  ['정', '井'], ['귀', '鬼'], ['류', '柳'], ['성', '星'], ['장', '張'], ['익', '翼'], ['진', '軫'],
] as const;

export const QUADRANTS = ['동방 청룡', '북방 현무', '서방 백호', '남방 주작'] as const;

export interface Sector {
  mansion: string;
  hanja: string;
  quadrant: string;
  index: number;
}

export function sectorOf(x: number, z: number): Sector {
  const angle = (Math.atan2(z, x) + Math.PI * 2) % (Math.PI * 2);
  const index = Math.min(27, Math.floor((angle / (Math.PI * 2)) * 28));
  const [mansion, hanja] = MANSIONS[index];
  return { mansion, hanja, quadrant: QUADRANTS[Math.floor(index / 7)], index };
}
