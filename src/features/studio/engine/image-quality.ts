/**
 * Image-quality hints for Studio image slots. Where the backend publishes an exact size for a slot (`x-slot`), the image is checked against
 * it; elsewhere the thresholds are deliberately conservative and slot-agnostic. They warn, they never block (the backend stays the validator).
 */
export type ImageFacts = { width: number | null; height: number | null };
export type ImageHint = { level: 'warn' | 'info'; message: string };
/** Minimum pixel size and shape for one slot, as published in `blocks.schema.json`. */
export type ImageSlot = { minWidth?: number; minHeight?: number; aspect?: string; kind?: 'video' };

/** "16:9" -> 1.777...; null when the text is not a ratio. */
export function aspectRatio(aspect: string | undefined): number | null {
  const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/u.exec(aspect ?? '');
  const ratio = match ? Number(match[1]) / Number(match[2]) : Number.NaN;
  return Number.isFinite(ratio) && ratio > 0 ? ratio : null;
}

/** One line telling the editor what the slot needs, e.g. "Needs at least 1080 × 608 px, 16:9 shape." */
export function slotRequirement(slot: ImageSlot): string {
  const size = slot.minWidth && slot.minHeight ? `${slot.minWidth} × ${slot.minHeight} px` : slot.minWidth ? `${slot.minWidth} px wide` : slot.minHeight ? `${slot.minHeight} px tall` : null;
  return [size ? `Needs at least ${size}` : 'Slot size not specified', slot.aspect ? `${slot.aspect} shape` : null].filter(Boolean).join(', ') + '.';
}

const ASPECT_TOLERANCE = 0.12;

export const MIN_USABLE_WIDTH = 600;
export const FULL_WIDTH_WIDTH = 1200;
export const EXTREME_ASPECT = 3;

export function imageQualityHints(media: ImageFacts, slot?: ImageSlot): ImageHint[] {
  const { width, height } = media;
  if (!width || !height) return [{ level: 'info', message: 'This image has no recorded pixel size, so its quality could not be checked.' }];
  const hints: ImageHint[] = [];
  if (slot && (slot.minWidth || slot.minHeight || slot.aspect)) {
    const short = (slot.minWidth && width < slot.minWidth) || (slot.minHeight && height < slot.minHeight);
    if (short) hints.push({ level: 'warn', message: `${width} × ${height} px is smaller than this slot needs. ${slotRequirement(slot)} It will look soft on large screens.` });
    const wanted = aspectRatio(slot.aspect);
    if (wanted && Math.abs(width / height - wanted) / wanted > ASPECT_TOLERANCE) {
      hints.push({ level: 'info', message: `This slot is ${slot.aspect}; the image is ${width} × ${height}, so the edges will be cropped. Check the crop and set the focal point.` });
    }
    return hints;
  }
  if (width < MIN_USABLE_WIDTH) hints.push({ level: 'warn', message: `Only ${width} px wide: it will look blurry in most slots. Use an image at least ${MIN_USABLE_WIDTH} px wide.` });
  else if (width < FULL_WIDTH_WIDTH) hints.push({ level: 'info', message: `${width} px wide is fine for cards and thumbnails but may look soft in full-width banners (aim for ${FULL_WIDTH_WIDTH} px or more).` });
  const ratio = width / height;
  if (ratio >= EXTREME_ASPECT || ratio <= 1 / EXTREME_ASPECT) hints.push({ level: 'warn', message: `Very ${ratio > 1 ? 'wide' : 'tall'} (${width}×${height}): it will be heavily cropped in most slots. Check the crop and set the focal point.` });
  return hints;
}
