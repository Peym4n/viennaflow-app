import { describe, expect, it } from 'vitest';
import { placeOverlay } from './custom-map-overlay';

describe('Station overlay placement', () => {
  it('keeps edge cards inside the map viewport', () => {
    const box = placeOverlay({ left: -100, top: 600, width: 320, height: 180 }, 1000, 700, []);
    expect(box.left).toBeGreaterThanOrEqual(12);
    expect(box.top + box.height).toBeLessThanOrEqual(688);
  });

  it('keeps three cards for adjacent stations readable without overlap', () => {
    const occupied: ReturnType<typeof placeOverlay>[] = [];
    for (let index = 0; index < 3; index++) {
      const box = placeOverlay({ left: 500 + index * 10, top: 300, width: 320, height: 180 }, 1200, 700, occupied);
      for (const other of occupied) {
        expect(box.left >= other.left + other.width || other.left >= box.left + box.width ||
          box.top >= other.top + other.height || other.top >= box.top + box.height).toBe(true);
      }
      occupied.push(box);
    }
  });
});
