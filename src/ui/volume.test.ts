import { describe, expect, it } from 'vitest';
import { DEFAULT_VOLUME, parseVolume } from './volume';

describe('저장된 볼륨 되살리기', () => {
  it('음소거(0)는 0으로 되살린다', () => {
    expect(parseVolume('0')).toBe(0);
  });

  it('저장된 적이 없으면 기본값', () => {
    expect(parseVolume(null)).toBe(DEFAULT_VOLUME);
    expect(parseVolume('')).toBe(DEFAULT_VOLUME);
  });

  it('고른 값은 그대로, 100을 넘으면 100', () => {
    expect(parseVolume('35')).toBe(35);
    expect(parseVolume('140')).toBe(100);
  });

  it('숫자가 아니거나 음수면 기본값', () => {
    expect(parseVolume('loud')).toBe(DEFAULT_VOLUME);
    expect(parseVolume('-5')).toBe(DEFAULT_VOLUME);
  });
});
