import { describe, expect, it } from 'vitest';
import { generateGalaxy, SPECTRAL_CLASSES } from './galaxy';
import { HEAVENLY_STEMS, starName } from './names';
import { StarGrid } from './neighbors';
import { hash32, Rng } from './rng';
import { makeSystem } from './system';

const HANGUL = /^[가-힣]+$/;

describe('난수', () => {
  it('같은 시드는 같은 수열을 낸다', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });

  it('해시는 입력 순서에 따라 달라진다', () => {
    expect(hash32(1, 2)).not.toBe(hash32(2, 1));
  });
});

describe('별 이름', () => {
  it('한글 음절로만 이루어지고 2~4자다', () => {
    for (let i = 0; i < 5000; i++) {
      const name = starName(new Rng(hash32(i, 11)));
      expect(name).toMatch(HANGUL);
      expect(name.length).toBeGreaterThanOrEqual(2);
      expect(name.length).toBeLessThanOrEqual(4);
    }
  });
});

describe('은하', () => {
  const galaxy = generateGalaxy('미리내', 20_000);

  it('같은 이름이면 같은 은하가 나온다', () => {
    const again = generateGalaxy('미리내', 20_000);
    expect(again.positions).toEqual(galaxy.positions);
    expect(again.classes).toEqual(galaxy.classes);
  });

  it('다른 이름이면 다른 은하가 나온다', () => {
    const other = generateGalaxy('은하수', 20_000);
    expect(other.positions).not.toEqual(galaxy.positions);
  });

  it('별은 은하 반지름 안팎에 모여 있다', () => {
    let outside = 0;
    for (let i = 0; i < galaxy.count; i++) {
      const r = Math.hypot(galaxy.positions[i * 3], galaxy.positions[i * 3 + 2]);
      if (r > 1300) outside++;
    }
    expect(outside / galaxy.count).toBeLessThan(0.01);
  });
});

describe('이웃 별', () => {
  const galaxy = generateGalaxy('미리내', 20_000);
  const grid = new StarGrid(galaxy);
  const brute = (index: number, count: number) => {
    const p = galaxy.positions;
    const out: { index: number; distance: number }[] = [];
    for (let j = 0; j < galaxy.count; j++) {
      if (j === index) continue;
      out.push({ index: j, distance: Math.hypot(p[j * 3] - p[index * 3], p[j * 3 + 1] - p[index * 3 + 1], p[j * 3 + 2] - p[index * 3 + 2]) });
    }
    return out.sort((a, b) => a.distance - b.distance).slice(0, count);
  };

  it('격자로 찾은 결과가 전부 훑은 결과와 같다', () => {
    for (const index of [0, 17, 999, 5432, 12000, 19999]) {
      const fast = grid.nearest(index, 6, 2000);
      expect(fast.map((n) => n.index)).toEqual(brute(index, 6).map((n) => n.index));
    }
  });

  it('자기 자신은 빠지고 가까운 순서다', () => {
    const list = grid.nearest(42, 8);
    expect(list.some((n) => n.index === 42)).toBe(false);
    for (let i = 1; i < list.length; i++) expect(list[i].distance).toBeGreaterThanOrEqual(list[i - 1].distance);
  });
});

describe('항성계', () => {
  const galaxy = generateGalaxy('미리내', 20_000);

  it('같은 별은 언제나 같은 계를 만든다', () => {
    expect(makeSystem(galaxy, 1234)).toEqual(makeSystem(galaxy, 1234));
  });

  it('행성 궤도는 안쪽부터 바깥으로 커지고 이름은 천간 순서다', () => {
    for (let i = 0; i < 2000; i++) {
      const { star, planets } = makeSystem(galaxy, i);
      expect(planets.length).toBeLessThanOrEqual(HEAVENLY_STEMS.length);
      planets.forEach((p, k) => {
        expect(p.name).toBe(`${star.name} ${HEAVENLY_STEMS[k]}`);
        if (k > 0) expect(p.orbitAU).toBeGreaterThan(planets[k - 1].orbitAU);
      });
    }
  });

  it('0번 별은 은하 한가운데의 초대질량 블랙홀이고 행성이 없다', () => {
    const { star, planets } = makeSystem(galaxy, 0);
    expect(star.kind).toBe('core');
    expect(star.name).toBe('미리내의 심장');
    expect(Array.from(galaxy.positions.subarray(0, 3))).toEqual([0, 0, 0]);
    expect(star.hole!.massSun).toBeGreaterThan(1e5);
    expect(planets).toHaveLength(0);
  });

  it('항성 블랙홀은 드물고 행성이 없다', () => {
    let holes = 0;
    for (let i = 1; i < galaxy.count; i++) {
      if (galaxy.kinds[i] !== 2) continue;
      holes++;
      const { star, planets } = makeSystem(galaxy, i);
      expect(star.hole!.massSun).toBeLessThan(30);
      expect(planets).toHaveLength(0);
    }
    expect(holes).toBeGreaterThan(0);
    expect(holes).toBeLessThan(galaxy.count * 0.002);
  });

  it('쌍성의 행성은 두 별 사이 거리의 3배보다 멀리 돈다', () => {
    let binaries = 0;
    for (let i = 0; i < galaxy.count && binaries < 300; i++) {
      const { star, planets } = makeSystem(galaxy, i);
      if (!star.companion) continue;
      binaries++;
      expect(SPECTRAL_CLASSES.indexOf(star.companion.cls)).toBeGreaterThanOrEqual(SPECTRAL_CLASSES.indexOf(star.cls));
      for (const p of planets) expect(p.orbitAU).toBeGreaterThanOrEqual(star.companion.separationAU * 3.2 - 1e-9);
    }
    expect(binaries).toBeGreaterThan(100);
  });

  it('문명은 거주 가능 구역의 지구형·바다 행성에만 있다', () => {
    let civs = 0;
    for (let i = 0; i < galaxy.count; i++) {
      for (const p of makeSystem(galaxy, i).planets) {
        if (p.life !== 3) continue;
        civs++;
        expect(['terran', 'ocean']).toContain(p.type);
        expect(p.inHabitableZone).toBe(true);
        expect(p.civSignal).not.toBeNull();
        expect(p.look.city).toBe(1);
      }
    }
    // 2만 개 중 문명은 드물지만 없지는 않아야 한다.
    expect(civs).toBeGreaterThan(5);
    expect(civs).toBeLessThan(galaxy.count * 0.02);
  });
});
