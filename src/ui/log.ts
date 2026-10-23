import { PLANET_TYPE_LABEL, type LifeLevel, type StarSystem } from '../gen/system';
import { tempC } from './format';

/** 탐사 일지 한 줄: 다녀간 항성계 하나 또는 행성 하나 */
export interface LogEntry {
  key: string;
  galaxy: string;
  star: number;
  planet: number | null;
  name: string;
  detail: string;
  life: LifeLevel;
  first: number;
  last: number;
  visits: number;
  starred: boolean;
  note: string;
}

export interface LogData {
  entries: LogEntry[];
  warps: number;
  warpLy: number;
}

type Visit = Pick<LogEntry, 'key' | 'galaxy' | 'star' | 'planet' | 'name' | 'detail' | 'life'>;

const STORAGE_KEY = 'mirinae:log:v1';
const EMPTY: LogData = { entries: [], warps: 0, warpLy: 0 };

export const entryKey = (galaxy: string, star: number, planet: number | null) => `${galaxy}|${star}|${planet ?? '-'}`;

// 저장소는 사생활 보호 모드 등에서 막혀 있을 수 있다. 막혀도 이번 방문 동안은 메모리로 동작한다.
function load(): LogData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    const data = JSON.parse(raw) as Partial<LogData>;
    if (!Array.isArray(data.entries)) return EMPTY;
    return { entries: data.entries, warps: Number(data.warps) || 0, warpLy: Number(data.warpLy) || 0 };
  } catch {
    return EMPTY;
  }
}

/** React useSyncExternalStore로 읽는 작은 저장소. 바뀔 때마다 새 객체를 만든다. */
class LogStore {
  private data: LogData = load();
  private listeners = new Set<() => void>();

  constructor() {
    // 다른 탭에서 일지를 고치면 따라간다.
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', (e) => {
        if (e.key !== STORAGE_KEY) return;
        this.data = load();
        this.emit();
      });
    }
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = (): LogData => this.data;

  private emit(): void {
    this.listeners.forEach((fn) => fn());
  }

  private commit(next: LogData): void {
    this.data = next;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // 저장이 안 되어도 화면은 계속 동작한다.
    }
    this.emit();
  }

  /** 방문을 남긴다. 처음 온 곳이면 true. */
  visit(v: Visit): boolean {
    const now = Date.now();
    const found = this.data.entries.find((e) => e.key === v.key);
    if (found) {
      this.commit({
        ...this.data,
        entries: this.data.entries.map((e) => (e.key === v.key ? { ...e, ...v, last: now, visits: e.visits + 1 } : e)),
      });
      return false;
    }
    const entry: LogEntry = { ...v, first: now, last: now, visits: 1, starred: false, note: '' };
    this.commit({ ...this.data, entries: [entry, ...this.data.entries] });
    return true;
  }

  warp(distanceLy: number): void {
    this.commit({ ...this.data, warps: this.data.warps + 1, warpLy: this.data.warpLy + distanceLy });
  }

  toggleStar(key: string): void {
    this.update(key, (e) => ({ ...e, starred: !e.starred }));
  }

  setNote(key: string, note: string): void {
    this.update(key, (e) => ({ ...e, note: note.slice(0, 500) }));
  }

  remove(key: string): void {
    this.commit({ ...this.data, entries: this.data.entries.filter((e) => e.key !== key) });
  }

  clear(): void {
    this.commit(EMPTY);
  }

  private update(key: string, fn: (e: LogEntry) => LogEntry): void {
    this.commit({ ...this.data, entries: this.data.entries.map((e) => (e.key === key ? fn(e) : e)) });
  }
}

export const logStore = new LogStore();

export function systemVisit(galaxy: string, system: StarSystem): Visit {
  const { star, planets } = system;
  return {
    key: entryKey(galaxy, star.index, null),
    galaxy,
    star: star.index,
    planet: null,
    name: star.name,
    detail: `${star.cls}형 · 행성 ${planets.length}개`,
    life: planets.reduce<LifeLevel>((m, p) => (p.life > m ? p.life : m), 0),
  };
}

export function planetVisit(galaxy: string, system: StarSystem, index: number): Visit {
  const p = system.planets[index];
  return {
    key: entryKey(galaxy, system.star.index, index),
    galaxy,
    star: system.star.index,
    planet: index,
    name: p.name,
    detail: `${PLANET_TYPE_LABEL[p.type]} · ${tempC(p.tempC)}`,
    life: p.life,
  };
}

const rtf = new Intl.RelativeTimeFormat('ko', { numeric: 'auto' });

/** 방금 전 · 3분 전 · 어제 */
export function relativeTime(ts: number, now = Date.now()): string {
  const s = Math.round((ts - now) / 1000);
  if (Math.abs(s) < 45) return '방금 전';
  const m = Math.round(s / 60);
  if (Math.abs(m) < 60) return rtf.format(m, 'minute');
  const h = Math.round(m / 60);
  if (Math.abs(h) < 24) return rtf.format(h, 'hour');
  return rtf.format(Math.round(h / 24), 'day');
}
