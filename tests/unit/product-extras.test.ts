import { describe, expect, it } from 'vitest';

import { galleryProblems, moveItem } from '@/features/catalog/product-extras';

describe('product gallery rules', () => {
  it('moves items within bounds only', () => {
    expect(moveItem([1, 2, 3], 0, 2)).toEqual([2, 3, 1]);
    expect(moveItem([1, 2, 3], 0, -1)).toEqual([1, 2, 3]);
    expect(moveItem([1, 2, 3], 2, 3)).toEqual([1, 2, 3]);
  });
  it('requires alt text, uniqueness and the 12-image cap', () => {
    expect(galleryProblems([{ mediaId: 'a', alt: '' }])).toEqual(['Image 1 needs alt text.']);
    expect(galleryProblems([{ mediaId: 'a', alt: 'x' }, { mediaId: 'a', alt: 'y' }])).toEqual(['The same image is listed twice.']);
    const many = Array.from({ length: 13 }, (_, i) => ({ mediaId: `m${i}`, alt: 'ok' }));
    expect(galleryProblems(many)).toEqual(['A product can have at most 12 images.']);
    expect(galleryProblems([{ mediaId: 'a', alt: 'fine' }])).toEqual([]);
  });
});
