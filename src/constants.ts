// ------------------------------------------------------------------
// CONFIGURATION
// ------------------------------------------------------------------
export const AUTO_SCROLL_THRESHOLD = 150; // pixels from edge to trigger auto-scroll
export const AUTO_SCROLL_MAX_SPEED = 12; // max pixels per frame at edge
export const AUTO_SCROLL_MIN_SPEED = 1; // min pixels per frame at threshold boundary
export const DEFAULT_DRAG_ACTIVATION_DELAY = 200; // ms to hold before drag activates
export const SWAP_THRESHOLD = 0.5; // percentage of item height needed to trigger swap

/** Spring used when neighboring items shift during a swap */
export const DEFAULT_ITEM_SPRING = { damping: 80, stiffness: 500 };
/** Timing used when the dragged item settles into its slot on release */
export const DEFAULT_DROP_TIMING = { duration: 180 };
/** Scale applied to the item while actively dragging */
export const DEFAULT_ACTIVE_SCALE = 1.03;
/** Legacy spring used when dropAnimation is 'spring' */
export const LEGACY_DROP_SPRING = { damping: 40, stiffness: 350 };
