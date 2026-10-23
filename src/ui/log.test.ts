import { beforeEach, describe, expect, it } from 'vitest';
import { generateGalaxy } from '../gen/galaxy';
import { makeSystem } from '../gen/system';
import { entryKey, logStore, planetVisit, relativeTime, systemVisit } from './log';

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
