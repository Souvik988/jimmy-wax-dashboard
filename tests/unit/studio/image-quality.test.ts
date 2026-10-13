import { describe, expect, it } from 'vitest';

import { aspectRatio, imageQualityHints, slotRequirement } from '@/features/studio/engine/image-quality';

describe('image quality hints', () => {
  it('says nothing for a large, normally shaped image', () => {
    expect(imageQualityHints({ width: 2400, height: 1600 })).toEqual([]);
  });

  it('warns about images too small for most slots', () => {
    const hints = imageQualityHints({ width: 480, height: 480 });
    expect(hints).toHaveLength(1);
    expect(hints[0]).toMatchObject({ level: 'warn' });
    expect(hints[0]?.message).toMatch(/480 px wide.*blurry/);
  });

  it('gives a softer note for mid-size images that suit cards but not full-width banners', () => {
    const hints = imageQualityHints({ width: 900, height: 900 });
    expect(hints).toEqual([{ level: 'info', message: expect.stringMatching(/900 px wide.*full-width/) }]);
  });

  it('warns about extreme shapes in either direction, even when large', () => {
    expect(imageQualityHints({ width: 3600, height: 900 })[0]).toMatchObject({ level: 'warn', message: expect.stringMatching(/Very wide/) });
    expect(imageQualityHints({ width: 1300, height: 4200 })[0]).toMatchObject({ level: 'warn', message: expect.stringMatching(/Very tall/) });
  });

  it('admits when the size is unknown instead of guessing', () => {
    expect(imageQualityHints({ width: null, height: null })).toEqual([{ level: 'info', message: expect.stringMatching(/could not be checked/) }]);
    expect(imageQualityHints({ width: 1200, height: 0 })[0]?.level).toBe('info');
  });

  describe('against the exact size the backend publishes for a slot', () => {
    const banner = { minWidth: 1080, minHeight: 608, aspect: '16:9' };

    it('accepts an image that meets the size and shape', () => {
      expect(imageQualityHints({ width: 1920, height: 1080 }, banner)).toEqual([]);
    });

    it('uses the slot size instead of the generic thresholds', () => {
      // 900 px wide only draws a generic "soft in banners" note, but this slot needs 1080.
      expect(imageQualityHints({ width: 900, height: 506 }, banner)[0]).toMatchObject({ level: 'warn', message: expect.stringMatching(/900 × 506 px is smaller than this slot needs\. Needs at least 1080 × 608 px, 16:9 shape\./) });
      // And a 700 px image is fine for a slot that only needs 240 px.
      expect(imageQualityHints({ width: 700, height: 700 }, { minWidth: 240, minHeight: 240, aspect: '1:1' })).toEqual([]);
    });

    it('treats a short height as too small even when the width is enough', () => {
      expect(imageQualityHints({ width: 1920, height: 500 }, banner).some((hint) => hint.level === 'warn')).toBe(true);
    });

    it('tells the editor the image will be cropped when its shape is far from the slot', () => {
      const hints = imageQualityHints({ width: 1600, height: 1200 }, banner);
      expect(hints).toEqual([{ level: 'info', message: expect.stringMatching(/slot is 16:9; the image is 1600 × 1200.*cropped/) }]);
      // Within 12 % is not worth mentioning.
      expect(imageQualityHints({ width: 1920, height: 1000 }, banner)).toEqual([]);
    });

    it('checks only the width when a slot publishes only a width', () => {
      expect(imageQualityHints({ width: 1200, height: 4000 }, { minWidth: 1600 })[0]).toMatchObject({ level: 'warn' });
      expect(imageQualityHints({ width: 1700, height: 4000 }, { minWidth: 1600 })).toEqual([]);
    });

    it('describes the requirement and parses ratios', () => {
      expect(slotRequirement(banner)).toBe('Needs at least 1080 × 608 px, 16:9 shape.');
      expect(slotRequirement({ minWidth: 1600, aspect: '16:9' })).toBe('Needs at least 1600 px wide, 16:9 shape.');
      expect(aspectRatio('3:2')).toBeCloseTo(1.5);
      expect(aspectRatio('wide')).toBeNull();
      expect(aspectRatio('0:5')).toBeNull();
    });
  });
});
