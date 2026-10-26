/** 처음 켰을 때의 볼륨(0–100). */
export const DEFAULT_VOLUME = 60;

/**
 * 저장된 볼륨 문자열을 0–100 값으로 바꾼다.
 * 저장된 적이 없을 때만 기본값을 쓴다. 0(음소거)도 사용자가 고른 값이라 그대로 되살린다.
 */
export function parseVolume(raw: string | null): number {
  if (raw === null || raw.trim() === '') return DEFAULT_VOLUME;
  const v = Number(raw);
  return Number.isFinite(v) && v >= 0 ? Math.min(100, v) : DEFAULT_VOLUME;
}
