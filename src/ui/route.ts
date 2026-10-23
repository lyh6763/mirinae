import type { Mode } from '../engine/Engine';

export const DEFAULT_GALAXY = '미리내';

export interface Route {
  galaxy: string;
  star: number | null;
  planet: number | null;
  mode: Mode;
}

const MODES: Record<string, Mode> = { g: 'galaxy', s: 'system', p: 'planet' };

function int(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value)) return null;
  return Number(value);
}

/** #g=미리내&s=12345&p=2&v=p 형식의 좌표를 읽는다. 잘못된 값은 버린다. */
export function parseHash(hash: string): Route {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const galaxy = (params.get('g') ?? '').trim().slice(0, 40) || DEFAULT_GALAXY;
  const star = int(params.get('s'));
  const planet = int(params.get('p'));
  const mode = star === null ? 'galaxy' : MODES[params.get('v') ?? ''] ?? 'galaxy';
  return { galaxy, star, planet, mode };
}

export function formatHash(route: Route): string {
  const params = new URLSearchParams();
  params.set('g', route.galaxy);
  if (route.star !== null) params.set('s', String(route.star));
  if (route.planet !== null) params.set('p', String(route.planet));
  if (route.mode !== 'galaxy') params.set('v', route.mode[0]);
  return `#${params.toString()}`;
}
