import { beforeEach, describe, expect, it } from 'vitest';
import { generateGalaxy } from '../gen/galaxy';
import { makeSystem } from '../gen/system';
import { entryKey, logStore, parseLog, planetVisit, relativeTime, systemVisit } from './log';

// 테스트 환경(node)에는 localStorage가 없어서 저장소는 메모리로만 동작한다.
describe('탐사 일지', () => {
  const galaxy = generateGalaxy('미리내', 5_000);
  const system = makeSystem(galaxy, 10);

  beforeEach(() => logStore.clear());

  it('처음 온 곳만 새 발견이고, 다시 오면 방문 횟수가 는다', () => {
    expect(logStore.visit(systemVisit('미리내', system))).toBe(true);
    expect(logStore.visit(systemVisit('미리내', system))).toBe(false);
    const entry = logStore.getSnapshot().entries[0];
    expect(entry.visits).toBe(2);
    expect(entry.key).toBe(entryKey('미리내', 10, null));
  });

  it('같은 별 번호라도 은하가 다르면 다른 기록이다', () => {
    logStore.visit(systemVisit('미리내', system));
    expect(logStore.visit(systemVisit('은하수', system))).toBe(true);
    expect(logStore.getSnapshot().entries).toHaveLength(2);
  });

  it('행성 기록은 행성 이름과 생명 단계를 담는다', () => {
    if (system.planets.length === 0) return;
    logStore.visit(planetVisit('미리내', system, 0));
    const entry = logStore.getSnapshot().entries[0];
    expect(entry.name).toBe(system.planets[0].name);
    expect(entry.life).toBe(system.planets[0].life);
  });

  it('즐겨찾기·메모·워프 누적', () => {
    logStore.visit(systemVisit('미리내', system));
    const key = logStore.getSnapshot().entries[0].key;
    logStore.toggleStar(key);
    logStore.setNote(key, '다시 와 볼 것');
    logStore.warp(300);
    logStore.warp(450);
    const data = logStore.getSnapshot();
    expect(data.entries[0].starred).toBe(true);
    expect(data.entries[0].note).toBe('다시 와 볼 것');
    expect(data.warps).toBe(2);
    expect(data.warpLy).toBe(750);
  });

  it('상대 시간', () => {
    const now = 1_000_000_000_000;
    expect(relativeTime(now - 10_000, now)).toBe('방금 전');
    expect(relativeTime(now - 3 * 60_000, now)).toBe('3분 전');
    expect(relativeTime(now - 26 * 3_600_000, now)).toBe('어제');
  });
});

describe('저장된 일지 읽기', () => {
  const entry = {
    key: entryKey('미리내', 10, null),
    galaxy: '미리내',
    star: 10,
    planet: null,
    name: '가람',
    detail: 'G형 · 행성 3개',
    life: 0,
    first: 1_000,
    last: 2_000,
    visits: 2,
    starred: false,
    note: '',
  };
  const read = (entries: unknown[], extra: Record<string, unknown> = {}) =>
    parseLog(JSON.stringify({ entries, warps: 1, warpLy: 300, ...extra }));

  it('정상 일지는 그대로 읽는다', () => {
    expect(read([entry])).toEqual({ entries: [entry], warps: 1, warpLy: 300 });
  });

  it('비었거나 깨진 값은 빈 일지로 읽는다', () => {
    expect(parseLog(null).entries).toEqual([]);
    expect(parseLog('{not json').entries).toEqual([]);
    expect(parseLog(JSON.stringify([entry])).entries).toEqual([]);
    expect(parseLog(JSON.stringify({ entries: 'x' })).entries).toEqual([]);
  });

  it('객체가 아닌 항목은 버린다(null 하나가 앱 전체를 멈추게 했다)', () => {
    expect(read([null, 3, 'x', entry]).entries).toEqual([entry]);
  });

  it('화면이 읽는 필드가 어긋난 항목만 빼고 나머지는 남긴다', () => {
    const planet = { ...entry, key: entryKey('미리내', 10, 1), planet: 1, name: '나래', life: 2 };
    const bad = [
      { ...entry, name: { text: '가람' } },
      { ...entry, star: -1 },
      { ...entry, planet: 1.5 },
      { ...entry, life: 4 },
      { ...entry, first: 'yesterday' },
      { ...entry, last: null },
    ];
    expect(read([...bad, planet]).entries).toEqual([planet]);
  });

  it('키는 좌표로 다시 만들고, 같은 곳이 두 줄이면 처음 것만 남긴다', () => {
    const entries = read([{ ...entry, key: 'wrong' }, { ...entry, name: '두 번째' }]).entries;
    expect(entries).toHaveLength(1);
    expect(entries[0].key).toBe(entryKey('미리내', 10, null));
    expect(entries[0].name).toBe('가람');
  });

  it('빠져도 되는 필드는 기본값으로, 워프 누적은 0 이상의 유한수로 읽는다', () => {
    const { visits, starred, note, ...minimal } = entry;
    expect(read([minimal]).entries[0]).toMatchObject({ visits: 1, starred: false, note: '' });
    expect(read([], { warps: -3, warpLy: 'Infinity' })).toMatchObject({ warps: 0, warpLy: 0 });
  });
});
