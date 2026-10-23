import type { Galaxy } from './galaxy';

// 한 칸 24단위(1,200광년). 은하는 반지름 1,000단위 안팎이라 칸 번호는 ±64 안에 든다.
const CELL = 24;
const OFF = 64;

function cellKey(ix: number, iy: number, iz: number): number {
  return ix + OFF + (iy + OFF) * 128 + (iz + OFF) * 16384;
}

export interface Neighbor {
  index: number;
  /** 화면 단위. 광년으로는 LY_PER_UNIT을 곱한다. */
  distance: number;
}

/** 별을 정육면체 칸에 나눠 담아, 가까운 별을 16만 개 전부 훑지 않고 찾는다. */
export class StarGrid {
  private cells = new Map<number, number[]>();

  constructor(private galaxy: Galaxy) {
    const p = galaxy.positions;
    for (let i = 0; i < galaxy.count; i++) {
      const k = cellKey(Math.floor(p[i * 3] / CELL), Math.floor(p[i * 3 + 1] / CELL), Math.floor(p[i * 3 + 2] / CELL));
      let list = this.cells.get(k);
      if (!list) this.cells.set(k, (list = []));
      list.push(i);
    }
  }

  /**
   * index에서 가까운 별을 가까운 순으로 count개 찾는다.
   * 칸 반경을 한 칸씩 넓히다가, count번째 별이 확실히 그 반경 안에 들면 멈춘다.
   */
  nearest(index: number, count = 8, maxDistance = 160): Neighbor[] {
    const p = this.galaxy.positions;
    const x = p[index * 3];
    const y = p[index * 3 + 1];
    const z = p[index * 3 + 2];
    const cx = Math.floor(x / CELL);
    const cy = Math.floor(y / CELL);
    const cz = Math.floor(z / CELL);
    const maxRing = Math.ceil(maxDistance / CELL);
    let found: Neighbor[] = [];

    for (let ring = 1; ring <= maxRing; ring++) {
      found = [];
      for (let dz = -ring; dz <= ring; dz++) {
        for (let dy = -ring; dy <= ring; dy++) {
          for (let dx = -ring; dx <= ring; dx++) {
            const list = this.cells.get(cellKey(cx + dx, cy + dy, cz + dz));
            if (!list) continue;
            for (const j of list) {
              if (j === index) continue;
              const d = Math.hypot(p[j * 3] - x, p[j * 3 + 1] - y, p[j * 3 + 2] - z);
              if (d <= maxDistance) found.push({ index: j, distance: d });
            }
          }
        }
      }
      found.sort((a, b) => a.distance - b.distance);
      // 이 반경에서 빠짐없이 훑은 거리는 (ring × 칸 크기)까지다.
      if (found.length >= count && found[count - 1].distance <= ring * CELL) break;
    }
    return found.slice(0, count);
  }
}
