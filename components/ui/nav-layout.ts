/** Bar height (excludes the gap below it, see navBottom). */
export const NAV_BAR_HEIGHT = 64;
/** Diameter of the capture button. */
export const CAPTURE_BUTTON_SIZE = 56;
/** Diameter of the brand ring around it; the notch is shaped for this. */
export const CAPTURE_RING_SIZE = CAPTURE_BUTTON_SIZE + 14;
/** Centre of the button, measured down from the bar's top edge (negative: above it). */
export const BUTTON_CENTER_Y = -5;
/** How far the capture button rises above the bar's top edge. */
export const CENTER_BUTTON_RISE = CAPTURE_BUTTON_SIZE / 2 - BUTTON_CENTER_Y;

/**
 * Distance from the screen's bottom edge to the bar: clear of the system
 * gesture bar / home indicator with room to breathe, so the bar floats
 * instead of resting on it. Everything stacked on the bar uses this too.
 */
export function navBottom(insetBottom: number): number {
  return Math.max(insetBottom + 12, 20);
}

/** Scroll-content bottom padding (added to the safe inset) that clears the bar, its gap, the rising button and a 16dp margin. */
export const NAV_CLEARANCE = NAV_BAR_HEIGHT + CENTER_BUTTON_RISE + 12 + 16;
