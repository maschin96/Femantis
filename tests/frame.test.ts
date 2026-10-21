import { describe, expect, it } from 'vitest';
import { fitDistance, viewFrame } from '../src/renderer/viewer/frame';

const none = { top: 0, right: 0, bottom: 0, left: 0 };

describe('viewport framing in the free area between floating panels', () => {
  it('leaves the projection untouched without insets', () => {
    expect(viewFrame(1000, 600, none)).toEqual({
      offsetX: 0,
      offsetY: 0,
      width: 1000,
      height: 600,
    });
  });

  it('moves the optical axis to the centre of the free area', () => {
    // Free area x ∈ [200, 900], y ∈ [150, 550]: centre (550, 350) vs. canvas centre (500, 300).
    const frame = viewFrame(1000, 600, { top: 150, right: 100, bottom: 50, left: 200 });
    expect(frame).toEqual({ offsetX: -50, offsetY: -50, width: 700, height: 400 });
  });

  it('ignores insets that would leave less than a quarter of the canvas', () => {
    expect(viewFrame(1000, 600, { top: 0, right: 400, bottom: 0, left: 400 })).toEqual(
      viewFrame(1000, 600, none),
    );
    expect(viewFrame(1000, 600, { top: 300, right: 0, bottom: 200, left: 0 })).toEqual(
      viewFrame(1000, 600, none),
    );
  });

  it('keeps the established fit distance for an uncovered canvas', () => {
    const radius = 2;
    const fov = 40;
    const expected =
      (radius / Math.sin(((fov / 2) * Math.PI) / 180)) * 1.15 * Math.max(1, 600 / 1000);
    expect(fitDistance(radius, fov, 1000, 600, viewFrame(1000, 600, none))).toBeCloseTo(
      expected,
      12,
    );
  });

  it('moves the camera back when panels cover part of the canvas', () => {
    const full = fitDistance(1, 40, 1000, 600, viewFrame(1000, 600, none));
    const framed = fitDistance(
      1,
      40,
      1000,
      600,
      viewFrame(1000, 600, { top: 150, right: 100, bottom: 50, left: 200 }),
    );
    expect(framed).toBeGreaterThan(full);
  });
});
