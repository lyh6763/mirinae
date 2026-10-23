import { describe, expect, it } from 'vitest';
import { generateGalaxy } from './galaxy';
import { makeSystem } from './system';
import { snoise, surfaceHeight, terrainOffset } from './terrain';

// GPU(셰이더 snoise)에서 읽어 온 기준값. 2026-10-22 브라우저에서 float 렌더 타깃으로 측정했다.
// JS 노이즈가 GPU와 어긋나면 저공비행 카메라가 산을 뚫거나 허공에 뜬다.
const GPU_REFERENCE: [[number, number, number], number][] = [
  [[0.31, -2.7, 5.12], 0.323632],
  [[-6.4, 1.25, 3.3], 0.683467],
  [[2, 2, 2], -0.208484],
  [[4.75, -0.6, -3.9], -0.116891],
  [[-1.1, -5.5, 0.42], 0.134245],
  [[6.9, 3.3, -6.1], -0.194145],
  [[0.05, 0.07, 0.11], -0.555023],
  [[-3.33, 4.44, -5.55], -0.693885],
  [[12.5, -8.25, 3.125], 0.142187],
  [[-0.5, 0.25, -0.125], -0.247567],
];

describe('지형 노이즈 (CPU)', () => {
  it('GPU 셰이더와 같은 값을 낸다', () => {
    for (const [[x, y, z], gpu] of GPU_REFERENCE) {
      expect(snoise(Math.fround(x), Math.fround(y), Math.fround(z))).toBeCloseTo(gpu, 4);
    }
  });

  it('값은 -1~1 안에 있다', () => {
    for (let i = 0; i < 5000; i++) {
      const v = snoise(Math.sin(i) * 40, Math.cos(i * 1.3) * 40, Math.sin(i * 0.7) * 40);
      expect(Math.abs(v)).toBeLessThanOrEqual(1);
    }
  });

  it('바다가 있는 행성의 높이는 해수면 아래로 내려가지 않는다', () => {
    const galaxy = generateGalaxy('미리내', 5_000);
    let checked = 0;
    for (let i = 0; i < galaxy.count && checked < 5; i++) {
      for (const p of makeSystem(galaxy, i).planets) {
        if (p.look.kind !== 0 || p.look.seaLevel <= -1.5) continue;
        const off = terrainOffset(p.seed);
        for (let k = 0; k < 200; k++) {
          const u = Math.sin(k * 12.9898) * 0.999;
          const t = k * 2.4;
          const s = Math.sqrt(1 - u * u);
          expect(surfaceHeight(p.look, off, 7, Math.cos(t) * s, u, Math.sin(t) * s)).toBeGreaterThanOrEqual(p.look.seaLevel);
        }
        checked++;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(5);
  });
});
