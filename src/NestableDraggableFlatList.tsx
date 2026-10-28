import React, {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
} from 'react';
import { StyleSheet, View, type ViewStyle, type StyleProp } from 'react-native';
import Animated, {
  useAnimatedReaction,
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  type SharedValue,
  type AnimatedRef,
  useFrameCallback,
  scrollTo,
  measure,
  runOnUI,
  runOnJS,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { useNestableScrollContainerContext } from './NestableContext';
import {
  DEFAULT_ITEM_SPRING,
  DEFAULT_DROP_TIMING,
  DEFAULT_ACTIVE_SCALE,
  LEGACY_DROP_SPRING,
} from './constants';
import type { ItemAnimationConfig } from './types';
import {
  commitDropPositionWithSections,
  getSectionAtPosition,
  moveDraggedOneStepTowardTarget,
} from './sectionSwap';

// ------------------------------------------------------------------
// CONFIGURATION
// ------------------------------------------------------------------
const AUTO_SCROLL_THRESHOLD = 160;
const AUTO_SCROLL_MAX_SPEED = 20;
const AUTO_SCROLL_MIN_SPEED = 1;
const AUTO_SCROLL_SMOOTHING = 0.28; // Lower = smoother transitions (0-1)
const DEFAULT_DRAG_ACTIVATION_DELAY = 200;
const SWAP_THRESHOLD = 0.5;
const CROSS_SECTION_SWAP_THRESHOLD = 0.45;
const DEFAULT_MAX_SWAPS_PER_UPDATE = 1;
const DEFAULT_ESTIMATED_ITEM_HEIGHT = 60;

// ------------------------------------------------------------------
// DRAG DISABLED ZONE CONTEXT & COMPONENT
// ------------------------------------------------------------------
type DragDisabledContextType = {
  isDragDisabled: boolean;
};

const DragDisabledContext = createContext<DragDisabledContextType>({
  isDragDisabled: false,
});

/**
 * Wrap content that should NOT trigger drag activation.
 * Useful for buttons, inputs, or other interactive elements within draggable items.
 *
 * @example
 * ```tsx
 * renderItem={({ item, drag }) => (
 *   <View>
 *     <Text>{item.title}</Text>
 *     <DragDisabledZone>
 *       <Button onPress={() => deleteItem(item.id)} title="Delete" />
 *     </DragDisabledZone>
 *   </View>
 * )}
 * ```
 */
export function DragDisabledZone({
  children,
  style,
}: {
  children: React.ReactNode;
  /** Optional layout for the overlay; defaults to absolute fill of the item */
  style?: StyleProp<ViewStyle>;
}) {
  // Use a Native gesture to capture touches and prevent them from
  // bubbling up to the Pan gesture that activates drag
  const nativeGesture = Gesture.Native();

  return (
    <DragDisabledContext.Provider value={{ isDragDisabled: true }}>
      <GestureDetector gesture={nativeGesture}>
        <View style={[styles.dragDisabledZone, style]} pointerEvents="box-none">
          {children}
        </View>
      </GestureDetector>
    </DragDisabledContext.Provider>
  );
}

export function useDragDisabled() {
  return useContext(DragDisabledContext).isDragDisabled;
}

// ------------------------------------------------------------------
// TYPES
// ------------------------------------------------------------------
export type RenderItemParams<T> = {
  item: T;
  drag: () => void;
  isActive: boolean;
  index: number;
};

export type NestableDraggableFlatListProps<T> = ItemAnimationConfig & {
  data: T[];
  /** Fixed height for all items (optional - if not provided, heights are measured dynamically) */
  itemHeight?: number;
  /** Estimated item height for initial layout before measurement (default: 60) */
  estimatedItemHeight?: number;
  renderItem: (params: RenderItemParams<T>) => React.ReactNode;
  onDragEnd: (data: T[]) => void;
  onDragStart?: (info: { key: string; index: number }) => void;
  keyExtractor: (item: T) => string;
  style?: ViewStyle;
  contentContainerStyle?: ViewStyle;
  dragActivationDelay?: number;
  /** Fraction of row height required to swap while dragging (default: 0.5) */
  swapThreshold?: number;
  /** Higher threshold when dragged center crosses a section boundary (default: 0.45) */
  crossSectionSwapThreshold?: number;
  /** Max slot moves per drag frame (default: 1) */
  maxSwapsPerUpdate?: number;
  /** When true, rows matching this predicate cannot be dragged or swapped with */
  isItemLocked?: (item: T, index: number) => boolean;
  /** When true, rows cannot start a drag but may still be valid drop targets */
  isItemDragDisabled?: (item: T, index: number) => boolean;
  /** Home section key per item; passive rows cannot swap across section boundaries */
  getItemSectionKey?: (item: T, index: number) => string;
  /** Keep dragged item Y within list content bounds (default: true) */
  clampDragToBounds?: boolean;
  /** Clip list overflow while an item is being dragged (default: true) */
  clipWhileDragging?: boolean;
  /** Per-item height estimate before onLayout measurement */
  getEstimatedItemHeight?: (item: T, index: number) => number;
  /** Header component rendered above the list items */
  ListHeaderComponent?: React.ReactNode;
  /** Footer component rendered below the list items */
  ListFooterComponent?: React.ReactNode;
  /** Distance from edge (in px) to trigger auto-scroll. Default: 100 */
  autoScrollThreshold?: number;
  /** Maximum auto-scroll speed (px per frame). Default: 12 */
  autoScrollMaxSpeed?: number;
  /** Minimum auto-scroll speed (px per frame). Default: 1 */
  autoScrollMinSpeed?: number;
  /** Smoothing factor for auto-scroll velocity transitions (0-1). Lower = smoother. Default: 0.15 */
  autoScrollSmoothing?: number;
  /** Called when the dragged item's section changes during a gesture */
  onCrossSectionBoundary?: (info: {
    key: string;
    fromSection: string;
    toSection: string;
  }) => void;
  /** Bump after external data rebuilds (e.g. post-drag) to snap row positions without remounting the list */
  layoutSyncRevision?: number;
  /** When true, long-press drag activation is ignored (UI-thread, no re-render) */
  dragActivationBlocked?: SharedValue<boolean>;
  /** Finger must move this many px before the row follows (0 = immediate). */
  dragStartSlop?: number;
};

// ------------------------------------------------------------------
// HELPER: Calculate item offset from heights
// ------------------------------------------------------------------
function getHeightForKey(
  key: string | undefined,
  heights: Record<string, number>,
  estimatedHeights: Record<string, number>,
  fallbackEstimated: number
): number {
  'worklet';
  if (!key) {
    return fallbackEstimated;
  }
  return heights[key] ?? estimatedHeights[key] ?? fallbackEstimated;
}

function isKeyLockedAtPosition(
  position: number,
  positions: Record<string, number>,
  lockedKeys: Record<string, boolean>,
  allKeys: string[]
): boolean {
  'worklet';
  const keyAtPosition = allKeys.find((k) => positions[k] === position);
  if (!keyAtPosition) {
    return false;
  }
  return lockedKeys[keyAtPosition] === true;
}

function findNextUnlockedPosition(
  from: number,
  direction: 1 | -1,
  totalCount: number,
  positions: Record<string, number>,
  lockedKeys: Record<string, boolean>,
  allKeys: string[]
): number | null {
  'worklet';
  let pos = from + direction;
  while (pos >= 0 && pos < totalCount) {
    if (!isKeyLockedAtPosition(pos, positions, lockedKeys, allKeys)) {
      return pos;
    }
    pos += direction;
  }
  return null;
}

function resolveDraggableTargetPosition(
  rawPosition: number,
  currentPosition: number,
  positions: Record<string, number>,
  lockedKeys: Record<string, boolean>,
  allKeys: string[],
  totalCount: number
): number {
  'worklet';
  const clampedRaw = Math.max(0, Math.min(rawPosition, totalCount - 1));

  if (!isKeyLockedAtPosition(clampedRaw, positions, lockedKeys, allKeys)) {
    return clampedRaw;
  }

  const direction: 1 | -1 = clampedRaw > currentPosition ? 1 : -1;
  const unlocked = findNextUnlockedPosition(
    clampedRaw - direction,
    direction,
    totalCount,
    positions,
    lockedKeys,
    allKeys
  );
  if (unlocked !== null) {
    return unlocked;
  }

  const opposite: 1 | -1 = direction === 1 ? -1 : 1;
  const fallback = findNextUnlockedPosition(
    clampedRaw,
    opposite,
    totalCount,
    positions,
    lockedKeys,
    allKeys
  );
  return fallback ?? currentPosition;
}

function buildKeysByPosition(
  positions: Record<string, number>,
  keys: string[],
  totalCount: number
): (string | undefined)[] {
  'worklet';
  const keysByPosition: (string | undefined)[] = new Array(totalCount);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (key === undefined) {
      continue;
    }
    const pos = positions[key];
    if (pos !== undefined && pos >= 0 && pos < totalCount) {
      keysByPosition[pos] = key;
    }
  }
  return keysByPosition;
}

function getItemOffset(
  heights: Record<string, number>,
  positions: Record<string, number>,
  targetPosition: number,
  keys: string[],
  estimatedHeights: Record<string, number>,
  fallbackEstimated: number
): number {
  'worklet';
  const keysByPosition = buildKeysByPosition(positions, keys, keys.length);
  let offset = 0;
  for (let i = 0; i < targetPosition; i++) {
    const keyAtSlot = keysByPosition[i];
    if (keyAtSlot === undefined) {
      continue;
    }
    offset += getHeightForKey(
      keyAtSlot,
      heights,
      estimatedHeights,
      fallbackEstimated
    );
  }
  return offset;
}

// Find which position an offset falls into
function getPositionAtOffset(
  heights: Record<string, number>,
  positions: Record<string, number>,
  offset: number,
  keys: string[],
  totalCount: number,
  estimatedHeights: Record<string, number>,
  fallbackEstimated: number
): number {
  'worklet';
  const keysByPosition = buildKeysByPosition(positions, keys, totalCount);
  let cumulative = 0;
  for (let i = 0; i < totalCount; i++) {
    const keyAtSlot = keysByPosition[i];
    if (keyAtSlot === undefined) {
      continue;
    }
    const height = getHeightForKey(
      keyAtSlot,
      heights,
      estimatedHeights,
      fallbackEstimated
    );
    if (offset < cumulative + height) {
      return i;
    }
    cumulative += height;
  }
  return totalCount - 1;
}

function getDraggablePositionAtOffset(
  heights: Record<string, number>,
  positions: Record<string, number>,
  offset: number,
  currentPosition: number,
  allKeys: string[],
  totalCount: number,
  estimatedHeights: Record<string, number>,
  fallbackEstimated: number,
  lockedKeys: Record<string, boolean>
): number {
  'worklet';
  const rawPosition = getPositionAtOffset(
    heights,
    positions,
    offset,
    allKeys,
    totalCount,
    estimatedHeights,
    fallbackEstimated
  );
  return resolveDraggableTargetPosition(
    rawPosition,
    currentPosition,
    positions,
    lockedKeys,
    allKeys,
    totalCount
  );
}

function clampDragTop(
  value: number,
  itemHeight: number,
  listHeight: number,
  clampDragToBounds: boolean
): number {
  'worklet';
  if (!clampDragToBounds) {
    return value;
  }
  const maxTop = Math.max(0, listHeight - itemHeight);
  return Math.min(Math.max(value, 0), maxTop);
}

function commitDropPosition(
  id: string,
  top: number,
  getItemHeight: (itemId: string) => number,
  heights: Record<string, number>,
  positions: Record<string, number>,
  allKeys: string[],
  totalCount: number,
  estimatedHeights: Record<string, number>,
  fallbackEstimated: number,
  lockedKeys: Record<string, boolean>,
  sectionByKey: Record<string, string>,
  dragDisabledKeys: Record<string, boolean>
): Record<string, number> {
  'worklet';
  const currentItemHeight = getItemHeight(id);
  const draggedCenter = top + currentItemHeight / 2;
  const currentPosition = positions[id] ?? 0;
  const targetPosition = getDraggablePositionAtOffset(
    heights,
    positions,
    draggedCenter,
    currentPosition,
    allKeys,
    totalCount,
    estimatedHeights,
    fallbackEstimated,
    lockedKeys
  );

  return commitDropPositionWithSections(
    id,
    targetPosition,
    positions,
    allKeys,
    totalCount,
    lockedKeys,
    sectionByKey,
    dragDisabledKeys
  );
}

function buildDenseOrder<T>(
  data: T[],
  currentPositions: Record<string, number>,
  keyExtractor: (item: T) => string
): T[] {
  const newOrder: T[] = new Array(data.length);
  let hasHole = false;

  data.forEach((item) => {
    const key = keyExtractor(item);
    const position = currentPositions[key];
    if (position !== undefined && position >= 0 && position < data.length) {
      if (newOrder[position] !== undefined) {
        hasHole = true;
      } else {
        newOrder[position] = item;
      }
    } else {
      hasHole = true;
    }
  });

  if (!hasHole && newOrder.every((item) => item !== undefined)) {
    return newOrder;
  }

  return [...data].sort((a, b) => {
    const posA = currentPositions[keyExtractor(a)] ?? 0;
    const posB = currentPositions[keyExtractor(b)] ?? 0;
    return posA - posB;
  });
}

// ------------------------------------------------------------------
// NESTABLE DRAGGABLE ITEM WRAPPER
// ------------------------------------------------------------------
type NestableDraggableItemProps = {
  id: string;
  index: number;
  child: React.ReactNode;
  positions: SharedValue<Record<string, number>>;
  heights: SharedValue<Record<string, number>>;
  estimatedHeights: SharedValue<Record<string, number>>;
  lockedKeys: SharedValue<Record<string, boolean>>;
  dragDisabledKeys: SharedValue<Record<string, boolean>>;
  activeDragCount: SharedValue<number>;
  isLocked: boolean;
  isDragDisabled: boolean;
  scrollY: SharedValue<number>;
  fixedItemHeight: number | undefined;
  estimatedItemHeight: number;
  totalCount: number;
  onDragFinalize: () => void;
  containerHeight: SharedValue<number>;
  containerTop: SharedValue<number>;
  contentHeight: SharedValue<number>;
  listHeight: SharedValue<number>;
  clampDragToBounds: boolean;
  scrollViewRef: AnimatedRef<any>;
  dragActivationDelay: number;
  outerScrollEnabled: SharedValue<boolean>;
  autoScrollThreshold: number;
  autoScrollMaxSpeed: number;
  autoScrollMinSpeed: number;
  autoScrollSmoothing: number;
  allKeys: string[];
  sectionByKey: SharedValue<Record<string, string>>;
  onHeightMeasured: (id: string, height: number) => void;
  swapThreshold: number;
  crossSectionSwapThreshold: number;
  maxSwapsPerUpdate: number;
  onCrossSectionBoundary?: (info: {
    key: string;
    fromSection: string;
    toSection: string;
  }) => void;
  onDragStart?: (info: { key: string; index: number }) => void;
  onSettlingStart?: () => void;
  onSettlingEnd?: () => void;
  onDragActiveChange?: (active: boolean) => void;
  layoutResetNonce: SharedValue<number>;
  dragActivationBlocked?: SharedValue<boolean>;
  /** Cumulative Y offset from per-item estimates (dynamic height lists) */
  initialEstimatedOffset?: number;
  dragStartSlop: number;
} & ItemAnimationConfig;

const NestableDraggableItem = ({
  id,
  index,
  child,
  positions,
  heights,
  estimatedHeights,
  lockedKeys,
  dragDisabledKeys,
  activeDragCount,
  isLocked,
  isDragDisabled,
  scrollY,
  fixedItemHeight,
  estimatedItemHeight,
  totalCount,
  onDragFinalize,
  containerHeight,
  containerTop,
  contentHeight,
  listHeight,
  clampDragToBounds,
  scrollViewRef,
  dragActivationDelay,
  outerScrollEnabled,
  autoScrollThreshold,
  autoScrollMaxSpeed,
  autoScrollMinSpeed,
  autoScrollSmoothing,
  allKeys,
  sectionByKey,
  onHeightMeasured,
  swapThreshold,
  crossSectionSwapThreshold,
  maxSwapsPerUpdate,
  onCrossSectionBoundary,
  onDragStart,
  onSettlingStart,
  onSettlingEnd,
  onDragActiveChange,
  layoutResetNonce,
  dragActivationBlocked,
  initialEstimatedOffset,
  dragStartSlop,
  itemSpringConfig = DEFAULT_ITEM_SPRING,
  dropAnimation = 'timing',
  dropTimingConfig = DEFAULT_DROP_TIMING,
  dropSpringConfig = LEGACY_DROP_SPRING,
  activeScale = DEFAULT_ACTIVE_SCALE,
}: NestableDraggableItemProps) => {
  const isDragging = useSharedValue(false);
  const isFollowingFinger = useSharedValue(dragStartSlop <= 0);
  // Track when item is settling to final position (prevents reaction interference)
  const isSettling = useSharedValue(false);
  const didFinalizeRef = React.useRef(false);

  const resetFinalizeGuard = React.useCallback(() => {
    didFinalizeRef.current = false;
  }, []);

  const finalizeDrag = React.useCallback(() => {
    if (didFinalizeRef.current) {
      return;
    }
    didFinalizeRef.current = true;
    isSettling.value = false;
    onSettlingEnd?.();
    onDragFinalize();
  }, [isSettling, onDragFinalize, onSettlingEnd]);

  const finalizeFallbackTimeoutRef = React.useRef<ReturnType<
    typeof setTimeout
  > | null>(null);

  const clearFinalizeFallback = React.useCallback(() => {
    if (finalizeFallbackTimeoutRef.current) {
      clearTimeout(finalizeFallbackTimeoutRef.current);
      finalizeFallbackTimeoutRef.current = null;
    }
  }, []);

  const scheduleFinalizeFallback = React.useCallback(() => {
    clearFinalizeFallback();
    finalizeFallbackTimeoutRef.current = setTimeout(() => {
      finalizeFallbackTimeoutRef.current = null;
      finalizeDrag();
    }, 400);
  }, [clearFinalizeFallback, finalizeDrag]);

  React.useEffect(() => clearFinalizeFallback, [clearFinalizeFallback]);

  // Calculate initial offset
  const initialOffset = useMemo(() => {
    if (fixedItemHeight !== undefined) {
      return index * fixedItemHeight;
    }
    // For dynamic heights, use cumulative per-item estimates when available
    return initialEstimatedOffset ?? index * estimatedItemHeight;
  }, [index, fixedItemHeight, estimatedItemHeight, initialEstimatedOffset]);

  const slotTop = useSharedValue(initialOffset);
  const dragTranslateY = useSharedValue(0);
  const scale = useSharedValue(1);

  const startY = useSharedValue(0);
  const startTop = useSharedValue(0);
  const startScrollY = useSharedValue(0);
  const currentFingerY = useSharedValue(0);
  const draggedSectionKey = useSharedValue('');
  // Smoothed scroll velocity for butter-smooth autoscroll
  const currentScrollVelocity = useSharedValue(0);

  // Get item height (fixed or measured)
  const getItemHeight = (itemId: string) => {
    'worklet';
    if (fixedItemHeight !== undefined) {
      return fixedItemHeight;
    }
    return getHeightForKey(
      itemId,
      heights.value,
      estimatedHeights.value,
      estimatedItemHeight
    );
  };

  // Calculate offset for a position
  const calculateOffset = (position: number) => {
    'worklet';
    if (fixedItemHeight !== undefined) {
      return position * fixedItemHeight;
    }
    return getItemOffset(
      heights.value,
      positions.value,
      position,
      allKeys,
      estimatedHeights.value,
      estimatedItemHeight
    );
  };

  const getAbsoluteTop = () => {
    'worklet';
    return slotTop.value + dragTranslateY.value;
  };

  const applyPositionToTop = (
    position: number,
    previousPosition: number | undefined,
    animate: boolean
  ) => {
    'worklet';
    const targetOffset = calculateOffset(position);
    const positionChanged =
      previousPosition !== undefined && position !== previousPosition;

    if (isDragging.value) {
      return;
    }

    if (isSettling.value) {
      return;
    }

    dragTranslateY.value = 0;

    if (activeDragCount.value > 0) {
      slotTop.value = withSpring(targetOffset, itemSpringConfig);
      return;
    }

    if (positionChanged && animate) {
      slotTop.value = withSpring(targetOffset, itemSpringConfig);
      return;
    }

    slotTop.value = targetOffset;
  };

  // Snap to new layout immediately when list membership/order changes externally
  useAnimatedReaction(
    () => layoutResetNonce.value,
    (current, previous) => {
      if (previous != null && current === previous) {
        return;
      }
      if (isDragging.value) {
        return;
      }
      const pos = positions.value[id];
      const effectivePos = pos !== undefined ? pos : index;
      if (effectivePos === undefined) {
        return;
      }
      dragTranslateY.value = 0;
      slotTop.value = calculateOffset(effectivePos);
    },
    [id, index, allKeys, fixedItemHeight, estimatedItemHeight]
  );

  // Sync top when slot, neighbor layout, or measured heights change
  useAnimatedReaction(
    () => ({
      pos: positions.value[id],
      h: heights.value,
      dragCount: activeDragCount.value,
      positions: positions.value,
    }),
    (current, previous) => {
      if (previous == null) {
        const pos = current.pos !== undefined ? current.pos : index;
        dragTranslateY.value = 0;
        slotTop.value = calculateOffset(pos);
        return;
      }
      if (current.pos === undefined) {
        dragTranslateY.value = 0;
        slotTop.value = calculateOffset(index);
        return;
      }
      const previousPos = previous?.pos;
      const layoutChanged =
        previous?.positions !== undefined &&
        current.positions !== previous.positions;

      // Locked headers (and other rows whose slot index is unchanged) still
      // need Y updates when neighbors swap, because offset is cumulative.
      if (current.dragCount > 0 && layoutChanged && !isDragging.value) {
        dragTranslateY.value = 0;
        slotTop.value = withSpring(
          calculateOffset(current.pos),
          itemSpringConfig
        );
        return;
      }

      const shouldAnimate = false;
      applyPositionToTop(current.pos, previousPos, shouldAnimate);
    },
    [id, allKeys, fixedItemHeight, estimatedItemHeight]
  );

  // Calculate target scroll speed using smooth easing
  // Uses a smooth sine-based ease for gradual acceleration
  const getTargetSpeed = (distanceFromEdge: number) => {
    'worklet';
    // Normalize distance: 0 = at edge, 1 = at threshold boundary
    const normalizedDistance = Math.min(
      1,
      Math.max(0, distanceFromEdge / autoScrollThreshold)
    );
    // Use smooth sine easing for gradual, natural acceleration
    // cos goes from 1 to -1, so (1 - cos) / 2 goes from 0 to 1
    const easedProgress =
      (1 - Math.cos((1 - normalizedDistance) * Math.PI)) / 2;
    return (
      autoScrollMinSpeed +
      (autoScrollMaxSpeed - autoScrollMinSpeed) * easedProgress
    );
  };

  // Linear interpolation helper for smooth transitions
  const lerp = (current: number, target: number, factor: number) => {
    'worklet';
    return current + (target - current) * factor;
  };

  const autoScrollFrame = useFrameCallback(() => {
    if (!isDragging.value) {
      return;
    }
    if (dragStartSlop > 0 && !isFollowingFinger.value) {
      return;
    }

    // Calculate finger position relative to the container (not the screen)
    const relativeFingerY = currentFingerY.value - containerTop.value;
    const distanceFromTop = relativeFingerY;
    const distanceFromBottom = containerHeight.value - relativeFingerY;
    const maxScroll = Math.max(0, contentHeight.value - containerHeight.value);

    let targetVelocity = 0;

    // Determine target velocity based on position in auto-scroll zones
    if (
      distanceFromTop < autoScrollThreshold &&
      distanceFromTop >= 0 &&
      scrollY.value > 0
    ) {
      // Target upward scroll (negative velocity)
      targetVelocity = -getTargetSpeed(distanceFromTop);
    } else if (
      distanceFromBottom < autoScrollThreshold &&
      distanceFromBottom >= 0 &&
      scrollY.value < maxScroll
    ) {
      // Target downward scroll (positive velocity)
      targetVelocity = getTargetSpeed(distanceFromBottom);
    }

    // Smoothly interpolate current velocity toward target
    // This creates butter-smooth acceleration/deceleration
    currentScrollVelocity.value = lerp(
      currentScrollVelocity.value,
      targetVelocity,
      autoScrollSmoothing
    );

    // Apply scroll if velocity is significant
    const scrollDelta = currentScrollVelocity.value;
    if (Math.abs(scrollDelta) > 0.1) {
      const newScroll = Math.max(
        0,
        Math.min(maxScroll, scrollY.value + scrollDelta)
      );
      scrollTo(scrollViewRef, 0, newScroll, false);

      // Update scrollY immediately to prevent race condition with onUpdate
      // The scroll handler will also update it, but this ensures consistency
      scrollY.value = newScroll;

      // Update the dragged item position to account for scroll
      const deltaY = currentFingerY.value - startY.value;
      const deltaScroll = newScroll - startScrollY.value;
      const rawTop = startTop.value + deltaY + deltaScroll;
      const clampedTop = clampDragTop(
        rawTop,
        getItemHeight(id),
        listHeight.value,
        clampDragToBounds
      );
      dragTranslateY.value = clampedTop - slotTop.value;
    }
  }, false);

  const startAutoScroll = React.useCallback(() => {
    autoScrollFrame.setActive(true);
  }, [autoScrollFrame]);

  const stopAutoScroll = React.useCallback(() => {
    autoScrollFrame.setActive(false);
  }, [autoScrollFrame]);

  const pan = Gesture.Pan()
    .enabled(!isLocked && !isDragDisabled)
    .activateAfterLongPress(dragActivationDelay)
    .failOffsetX([-15, 15])
    .onStart((e: { absoluteY: number }) => {
      if (lockedKeys.value[id] || dragDisabledKeys.value[id]) {
        return;
      }
      if (dragActivationBlocked?.value) {
        return;
      }
      // Only set isDragging when gesture actually activates (after long press)
      isDragging.value = true;
      isSettling.value = false;
      scale.value = withSpring(activeScale, itemSpringConfig);
      // Reset scroll velocity for fresh start
      currentScrollVelocity.value = 0;
      // Disable outer scroll while dragging
      outerScrollEnabled.value = false;

      isFollowingFinger.value = dragStartSlop <= 0;
      if (isFollowingFinger.value) {
        runOnJS(startAutoScroll)();
      }

      if (onDragActiveChange) {
        runOnJS(onDragActiveChange)(true);
      }

      // Re-measure container position at drag start for accurate auto-scroll
      // This is crucial for BottomSheet scenarios where the container position
      // may have changed since the last layout measurement
      const measurement = measure(scrollViewRef);
      if (measurement) {
        containerTop.value = measurement.pageY;
        containerHeight.value = measurement.height;
      }

      startY.value = e.absoluteY;
      startScrollY.value = scrollY.value;
      currentFingerY.value = e.absoluteY;
      const currentPosition = positions.value[id] ?? 0;
      startTop.value = calculateOffset(currentPosition);
      draggedSectionKey.value =
        getSectionAtPosition(
          currentPosition,
          positions.value,
          allKeys,
          sectionByKey.value,
          lockedKeys.value
        ) ??
        sectionByKey.value[id] ??
        '';
      slotTop.value = startTop.value;
      dragTranslateY.value = 0;

      if (onDragStart) {
        runOnJS(onDragStart)({ key: id, index });
      }
    })
    .onUpdate((e: { absoluteY: number }) => {
      currentFingerY.value = e.absoluteY;

      if (dragStartSlop > 0 && !isFollowingFinger.value) {
        if (Math.abs(e.absoluteY - startY.value) < dragStartSlop) {
          return;
        }
        isFollowingFinger.value = true;
        runOnJS(startAutoScroll)();
      }

      const deltaY = e.absoluteY - startY.value;
      const deltaScroll = scrollY.value - startScrollY.value;
      const rawTop = startTop.value + deltaY + deltaScroll;
      const clampedTop = clampDragTop(
        rawTop,
        getItemHeight(id),
        listHeight.value,
        clampDragToBounds
      );
      dragTranslateY.value = clampedTop - slotTop.value;

      const currentPosition = positions.value[id] ?? 0;
      const currentItemHeight = getItemHeight(id);
      const currentOffset = calculateOffset(currentPosition);
      const absoluteTop = getAbsoluteTop();
      const displacement = absoluteTop - currentOffset;

      const draggedCenter = absoluteTop + currentItemHeight / 2;
      const targetPosition = getDraggablePositionAtOffset(
        heights.value,
        positions.value,
        draggedCenter,
        currentPosition,
        allKeys,
        totalCount,
        estimatedHeights.value,
        estimatedItemHeight,
        lockedKeys.value
      );

      const targetSection =
        getSectionAtPosition(
          targetPosition,
          positions.value,
          allKeys,
          sectionByKey.value,
          lockedKeys.value
        ) ?? '';
      const currentSection =
        getSectionAtPosition(
          currentPosition,
          positions.value,
          allKeys,
          sectionByKey.value,
          lockedKeys.value
        ) ?? draggedSectionKey.value;
      const isCrossSectionMove =
        targetSection !== '' &&
        currentSection !== '' &&
        targetSection !== currentSection;
      const effectiveThreshold = isCrossSectionMove
        ? crossSectionSwapThreshold
        : swapThreshold;
      const thresholdDistance = currentItemHeight * effectiveThreshold;

      if (Math.abs(displacement) > thresholdDistance) {
        const clampedTargetPosition = Math.max(
          0,
          Math.min(targetPosition, totalCount - 1)
        );

        let activePosition = currentPosition;
        let swapGuard = 0;

        while (
          swapGuard < maxSwapsPerUpdate &&
          clampedTargetPosition !== activePosition
        ) {
          const nextPositions = moveDraggedOneStepTowardTarget(
            id,
            clampedTargetPosition,
            positions.value,
            allKeys,
            totalCount,
            lockedKeys.value,
            sectionByKey.value,
            dragDisabledKeys.value
          );
          const updatedPosition = nextPositions[id] ?? 0;

          if (updatedPosition === activePosition) {
            break;
          }

          positions.value = nextPositions;
          activePosition = updatedPosition;

          const newSection =
            getSectionAtPosition(
              activePosition,
              positions.value,
              allKeys,
              sectionByKey.value,
              lockedKeys.value
            ) ?? '';
          if (
            onCrossSectionBoundary &&
            newSection !== '' &&
            draggedSectionKey.value !== '' &&
            newSection !== draggedSectionKey.value
          ) {
            runOnJS(onCrossSectionBoundary)({
              key: id,
              fromSection: draggedSectionKey.value,
              toSection: newSection,
            });
            draggedSectionKey.value = newSection;
          }

          swapGuard += 1;

          const newOffset = calculateOffset(activePosition);
          const newDisplacement = getAbsoluteTop() - newOffset;

          if (Math.abs(newDisplacement) <= thresholdDistance) {
            break;
          }
        }
      }
    })
    .onFinalize(() => {
      // Only handle finalization if drag was actually started
      if (!isDragging.value) {
        return;
      }

      runOnJS(resetFinalizeGuard)();

      // Commit nearest slot from release position (handles quick release)
      positions.value = commitDropPosition(
        id,
        getAbsoluteTop(),
        getItemHeight,
        heights.value,
        positions.value,
        allKeys,
        totalCount,
        estimatedHeights.value,
        estimatedItemHeight,
        lockedKeys.value,
        sectionByKey.value,
        dragDisabledKeys.value
      );

      // Mark as settling before starting animation
      isSettling.value = true;
      isDragging.value = false;
      isFollowingFinger.value = false;
      scale.value = withSpring(1, itemSpringConfig);
      // Reset scroll velocity
      currentScrollVelocity.value = 0;

      runOnJS(stopAutoScroll)();

      if (onSettlingStart) {
        runOnJS(onSettlingStart)();
      }

      if (onDragActiveChange) {
        runOnJS(onDragActiveChange)(false);
      }

      const targetPosition = positions.value[id] ?? 0;
      const finalTop = calculateOffset(targetPosition);

      runOnJS(scheduleFinalizeFallback)();

      const onDropFinished = (finished?: boolean) => {
        'worklet';
        if (finished === false || finished === true) {
          runOnJS(clearFinalizeFallback)();
          runOnJS(finalizeDrag)();
        }
      };

      if (dropAnimation === 'spring') {
        dragTranslateY.value = withSpring(0, dropSpringConfig);
        slotTop.value = withSpring(finalTop, dropSpringConfig, onDropFinished);
      } else {
        dragTranslateY.value = withTiming(0, dropTimingConfig);
        slotTop.value = withTiming(finalTop, dropTimingConfig, onDropFinished);
      }

      // Re-enable outer scroll
      outerScrollEnabled.value = true;
    });

  const animatedStyle = useAnimatedStyle(() => {
    return {
      top: slotTop.value,
      zIndex: isDragging.value ? 9999 : isSettling.value ? 9998 : 1,
      transform: [{ translateY: dragTranslateY.value }, { scale: scale.value }],
    };
  });

  // Handle layout measurement for dynamic heights
  const handleLayout = React.useCallback(
    (event: { nativeEvent: { layout: { height: number } } }) => {
      if (fixedItemHeight === undefined) {
        const measuredHeight = event.nativeEvent.layout.height;
        onHeightMeasured(id, measuredHeight);
      }
    },
    [id, fixedItemHeight, onHeightMeasured]
  );

  return (
    <GestureDetector
      gesture={isLocked || isDragDisabled ? Gesture.Native() : pan}
    >
      <Animated.View
        onLayout={handleLayout}
        style={[
          styles.itemContainer,
          fixedItemHeight !== undefined && { height: fixedItemHeight },
          animatedStyle,
        ]}
      >
        {child}
      </Animated.View>
    </GestureDetector>
  );
};

// ------------------------------------------------------------------
// NESTABLE DRAGGABLE FLAT LIST
// ------------------------------------------------------------------
export function NestableDraggableFlatList<T extends { id?: string | number }>({
  data,
  itemHeight: fixedItemHeight,
  estimatedItemHeight = DEFAULT_ESTIMATED_ITEM_HEIGHT,
  renderItem,
  onDragEnd,
  onDragStart,
  keyExtractor,
  style,
  contentContainerStyle,
  dragActivationDelay = DEFAULT_DRAG_ACTIVATION_DELAY,
  swapThreshold = SWAP_THRESHOLD,
  crossSectionSwapThreshold = CROSS_SECTION_SWAP_THRESHOLD,
  maxSwapsPerUpdate = DEFAULT_MAX_SWAPS_PER_UPDATE,
  isItemLocked,
  isItemDragDisabled,
  getItemSectionKey,
  clampDragToBounds = true,
  clipWhileDragging = true,
  getEstimatedItemHeight,
  ListHeaderComponent,
  ListFooterComponent,
  autoScrollThreshold = AUTO_SCROLL_THRESHOLD,
  autoScrollMaxSpeed = AUTO_SCROLL_MAX_SPEED,
  autoScrollMinSpeed = AUTO_SCROLL_MIN_SPEED,
  autoScrollSmoothing = AUTO_SCROLL_SMOOTHING,
  onCrossSectionBoundary,
  itemSpringConfig,
  dropAnimation,
  dropTimingConfig,
  dropSpringConfig,
  activeScale,
  layoutSyncRevision,
  dragActivationBlocked: dragActivationBlockedProp,
  dragStartSlop = 0,
}: NestableDraggableFlatListProps<T>) {
  const {
    scrollY,
    containerHeight,
    containerTop,
    scrollViewRef,
    outerScrollEnabled,
    contentHeight,
  } = useNestableScrollContainerContext();

  const internalDragActivationBlocked = useSharedValue(false);
  const dragActivationBlocked =
    dragActivationBlockedProp ?? internalDragActivationBlocked;

  // All item keys for position/height lookups
  const allKeys = useMemo(
    () => data.map((item) => keyExtractor(item)),
    [data, keyExtractor]
  );

  const lockedKeysMap = useMemo(() => {
    const map: Record<string, boolean> = {};
    data.forEach((item, index) => {
      const key = keyExtractor(item);
      map[key] = isItemLocked?.(item, index) ?? false;
    });
    return map;
  }, [data, isItemLocked, keyExtractor]);

  const lockedKeys = useSharedValue<Record<string, boolean>>(lockedKeysMap);

  const dragDisabledKeysMap = useMemo(() => {
    const map: Record<string, boolean> = {};
    data.forEach((item, index) => {
      const key = keyExtractor(item);
      map[key] = isItemDragDisabled?.(item, index) ?? false;
    });
    return map;
  }, [data, isItemDragDisabled, keyExtractor]);

  const dragDisabledKeys =
    useSharedValue<Record<string, boolean>>(dragDisabledKeysMap);

  const sectionByKeyMap = useMemo(() => {
    if (!getItemSectionKey) {
      return {};
    }
    const map: Record<string, string> = {};
    data.forEach((item, index) => {
      const key = keyExtractor(item);
      map[key] = getItemSectionKey(item, index);
    });
    return map;
  }, [data, getItemSectionKey, keyExtractor]);

  const sectionByKey = useSharedValue<Record<string, string>>(sectionByKeyMap);
  const sectionByKeyFrozenRef = React.useRef(false);

  const estimatedHeightsMap = useMemo(() => {
    const map: Record<string, number> = {};
    data.forEach((item, index) => {
      const key = keyExtractor(item);
      map[key] = getEstimatedItemHeight?.(item, index) ?? estimatedItemHeight;
    });
    return map;
  }, [data, estimatedItemHeight, getEstimatedItemHeight, keyExtractor]);

  const estimatedHeights =
    useSharedValue<Record<string, number>>(estimatedHeightsMap);

  const initialEstimatedOffsets = useMemo(() => {
    const offsets: Record<string, number> = {};
    let cumulative = 0;
    data.forEach((item, index) => {
      const key = keyExtractor(item);
      offsets[key] = cumulative;
      cumulative +=
        estimatedHeightsMap[key] ??
        getEstimatedItemHeight?.(item, index) ??
        estimatedItemHeight;
    });
    return offsets;
  }, [
    data,
    estimatedHeightsMap,
    estimatedItemHeight,
    getEstimatedItemHeight,
    keyExtractor,
  ]);

  const activeDragCount = useSharedValue(0);

  React.useEffect(() => {
    lockedKeys.value = lockedKeysMap;
  }, [lockedKeys, lockedKeysMap]);

  React.useEffect(() => {
    dragDisabledKeys.value = dragDisabledKeysMap;
  }, [dragDisabledKeys, dragDisabledKeysMap]);

  React.useEffect(() => {
    if (sectionByKeyFrozenRef.current) {
      return;
    }
    sectionByKey.value = sectionByKeyMap;
  }, [sectionByKey, sectionByKeyMap]);

  React.useEffect(() => {
    estimatedHeights.value = estimatedHeightsMap;
  }, [estimatedHeights, estimatedHeightsMap]);

  const positions = useSharedValue<Record<string, number>>(
    Object.fromEntries(data.map((item, index) => [keyExtractor(item), index]))
  );
  const layoutResetNonce = useSharedValue(0);

  const dataKeySequence = useMemo(
    () => data.map((item) => keyExtractor(item)).join('\0'),
    [data, keyExtractor]
  );

  // Track measured heights for dynamic sizing
  const heights = useSharedValue<Record<string, number>>({});

  // Calculate total list height
  const listContentHeight = useMemo(() => {
    if (fixedItemHeight !== undefined) {
      return data.length * fixedItemHeight;
    }
    return data.reduce(
      (total, item, index) =>
        total + (getEstimatedItemHeight?.(item, index) ?? estimatedItemHeight),
      0
    );
  }, [data, fixedItemHeight, estimatedItemHeight, getEstimatedItemHeight]);

  // Track measured total height for dynamic lists (UI thread — no React re-renders)
  const measuredTotalHeightSV = useSharedValue(listContentHeight);
  const [isDraggingActive, setIsDraggingActive] = React.useState(false);
  const activeDragCountRef = React.useRef(0);
  const settlingCountRef = React.useRef(0);
  const pendingLayoutResetRef = React.useRef(false);
  const pendingHeightUpdateRef = React.useRef(false);

  const listHeight = useSharedValue(listContentHeight);

  React.useEffect(() => {
    if (activeDragCountRef.current > 0 || settlingCountRef.current > 0) {
      pendingHeightUpdateRef.current = true;
      return;
    }
    measuredTotalHeightSV.value = listContentHeight;
    listHeight.value = listContentHeight;
  }, [listContentHeight, listHeight, measuredTotalHeightSV]);

  const recomputeTotalHeightOnUI = React.useCallback(() => {
    'worklet';
    if (fixedItemHeight !== undefined) {
      return;
    }
    let total = 0;
    for (const key of allKeys) {
      total +=
        heights.value[key] ??
        estimatedHeights.value[key] ??
        estimatedItemHeight;
    }
    measuredTotalHeightSV.value = total;
    listHeight.value = total;
  }, [
    allKeys,
    estimatedItemHeight,
    fixedItemHeight,
    heights,
    estimatedHeights,
    listHeight,
    measuredTotalHeightSV,
  ]);

  const isLayoutIdle = React.useCallback(() => {
    return activeDragCountRef.current === 0 && settlingCountRef.current === 0;
  }, []);

  const applyLayoutFromData = React.useCallback(() => {
    positions.value = Object.fromEntries(
      data.map((item, index) => [keyExtractor(item), index])
    );
    layoutResetNonce.value += 1;

    if (fixedItemHeight === undefined) {
      runOnUI(recomputeTotalHeightOnUI)();
    }
  }, [
    data,
    fixedItemHeight,
    keyExtractor,
    positions,
    layoutResetNonce,
    recomputeTotalHeightOnUI,
  ]);

  const tryFlushDeferredHeight = React.useCallback(() => {
    if (!isLayoutIdle()) {
      return;
    }
    if (pendingHeightUpdateRef.current && fixedItemHeight === undefined) {
      pendingHeightUpdateRef.current = false;
      runOnUI(recomputeTotalHeightOnUI)();
    }
  }, [fixedItemHeight, isLayoutIdle, recomputeTotalHeightOnUI]);

  const tryFlushDeferredLayout = React.useCallback(() => {
    if (!isLayoutIdle()) {
      return;
    }
    tryFlushDeferredHeight();
    if (pendingLayoutResetRef.current) {
      pendingLayoutResetRef.current = false;
      applyLayoutFromData();
    }
  }, [applyLayoutFromData, isLayoutIdle, tryFlushDeferredHeight]);

  const tryApplyLayoutFromData = React.useCallback(() => {
    if (!isLayoutIdle()) {
      pendingLayoutResetRef.current = true;
      return;
    }
    pendingLayoutResetRef.current = false;
    applyLayoutFromData();
  }, [applyLayoutFromData, isLayoutIdle]);

  const tryApplyLayoutFromDataRef = React.useRef(tryApplyLayoutFromData);
  tryApplyLayoutFromDataRef.current = tryApplyLayoutFromData;

  const dataKeySequenceAtDragStartRef = React.useRef<string | null>(null);

  const handleDragActiveChange = React.useCallback(
    (active: boolean) => {
      if (active) {
        dataKeySequenceAtDragStartRef.current = dataKeySequence;
        sectionByKeyFrozenRef.current = true;
        sectionByKey.value = { ...sectionByKeyMap };
        activeDragCount.value += 1;
        activeDragCountRef.current += 1;
        if (clipWhileDragging) {
          setIsDraggingActive(true);
        }
        return;
      }
      activeDragCount.value = Math.max(0, activeDragCount.value - 1);
      activeDragCountRef.current = Math.max(0, activeDragCountRef.current - 1);
      if (activeDragCountRef.current === 0) {
        sectionByKeyFrozenRef.current = false;
        sectionByKey.value = sectionByKeyMap;
        dataKeySequenceAtDragStartRef.current = null;
        if (clipWhileDragging) {
          setIsDraggingActive(false);
        }
      }
      tryFlushDeferredLayout();
    },
    [
      activeDragCount,
      clipWhileDragging,
      dataKeySequence,
      sectionByKey,
      sectionByKeyMap,
      tryFlushDeferredLayout,
    ]
  );

  const handleSettlingStart = React.useCallback(() => {
    settlingCountRef.current += 1;
  }, []);

  const handleSettlingEnd = React.useCallback(() => {
    settlingCountRef.current = Math.max(0, settlingCountRef.current - 1);
    tryFlushDeferredLayout();
  }, [tryFlushDeferredLayout]);

  // Update measured total height when heights change
  const updateTotalHeight = React.useCallback(() => {
    if (fixedItemHeight !== undefined) return;
    if (!isLayoutIdle()) {
      pendingHeightUpdateRef.current = true;
      return;
    }
    pendingHeightUpdateRef.current = false;
    runOnUI(recomputeTotalHeightOnUI)();
  }, [fixedItemHeight, isLayoutIdle, recomputeTotalHeightOnUI]);

  // Recompute list height and prune stale measurements when membership changes
  React.useEffect(() => {
    if (fixedItemHeight !== undefined) {
      return;
    }

    runOnUI(() => {
      const nextHeights: Record<string, number> = {};
      for (const key of allKeys) {
        const measured = heights.value[key];
        if (measured !== undefined) {
          nextHeights[key] = measured;
        }
      }
      heights.value = nextHeights;
    })();

    updateTotalHeight();
  }, [
    allKeys,
    estimatedHeightsMap,
    fixedItemHeight,
    heights,
    updateTotalHeight,
  ]);

  // Handle height measurement from items
  const handleHeightMeasured = React.useCallback(
    (id: string, height: number) => {
      const currentHeight = heights.value[id];
      if (currentHeight !== height) {
        runOnUI(() => {
          heights.value = { ...heights.value, [id]: height };
          if (activeDragCount.value === 0) {
            recomputeTotalHeightOnUI();
          }
        })();
        if (activeDragCountRef.current > 0 || settlingCountRef.current > 0) {
          pendingHeightUpdateRef.current = true;
        } else {
          pendingHeightUpdateRef.current = false;
        }
      }
    },
    [activeDragCount, heights, recomputeTotalHeightOnUI]
  );

  useLayoutEffect(() => {
    tryApplyLayoutFromDataRef.current();
  }, [dataKeySequence, layoutSyncRevision]);

  const handleDragFinalize = React.useCallback(() => {
    if (
      dataKeySequenceAtDragStartRef.current != null &&
      dataKeySequenceAtDragStartRef.current !== dataKeySequence
    ) {
      applyLayoutFromData();
      return;
    }
    const currentPositions = positions.value;
    onDragEnd(buildDenseOrder(data, currentPositions, keyExtractor));
  }, [
    applyLayoutFromData,
    data,
    dataKeySequence,
    keyExtractor,
    onDragEnd,
    positions,
  ]);

  const listContainerAnimatedStyle = useAnimatedStyle(() => {
    if (fixedItemHeight !== undefined) {
      return { height: listContentHeight };
    }
    return { height: measuredTotalHeightSV.value };
  }, [fixedItemHeight, listContentHeight]);

  const listOverflowStyle =
    clipWhileDragging && isDraggingActive ? styles.listClip : undefined;

  return (
    <View style={style}>
      {ListHeaderComponent}
      <Animated.View
        style={[
          styles.listContainer,
          listOverflowStyle,
          contentContainerStyle,
          listContainerAnimatedStyle,
        ]}
      >
        {data.map((item, index) => {
          const key = keyExtractor(item);
          const isLocked = lockedKeysMap[key] ?? false;
          const isDragDisabled = dragDisabledKeysMap[key] ?? false;
          return (
            <NestableDraggableItem
              key={key}
              id={key}
              index={index}
              positions={positions}
              heights={heights}
              estimatedHeights={estimatedHeights}
              lockedKeys={lockedKeys}
              dragDisabledKeys={dragDisabledKeys}
              activeDragCount={activeDragCount}
              isLocked={isLocked}
              isDragDisabled={isDragDisabled}
              scrollY={scrollY}
              fixedItemHeight={fixedItemHeight}
              estimatedItemHeight={estimatedItemHeight}
              totalCount={data.length}
              onDragFinalize={handleDragFinalize}
              containerHeight={containerHeight}
              containerTop={containerTop}
              contentHeight={contentHeight}
              listHeight={listHeight}
              clampDragToBounds={clampDragToBounds}
              scrollViewRef={scrollViewRef}
              dragActivationDelay={dragActivationDelay}
              outerScrollEnabled={outerScrollEnabled}
              autoScrollThreshold={autoScrollThreshold}
              autoScrollMaxSpeed={autoScrollMaxSpeed}
              autoScrollMinSpeed={autoScrollMinSpeed}
              autoScrollSmoothing={autoScrollSmoothing}
              allKeys={allKeys}
              sectionByKey={sectionByKey}
              onHeightMeasured={handleHeightMeasured}
              swapThreshold={swapThreshold}
              crossSectionSwapThreshold={crossSectionSwapThreshold}
              maxSwapsPerUpdate={maxSwapsPerUpdate}
              onCrossSectionBoundary={onCrossSectionBoundary}
              onDragStart={onDragStart}
              onSettlingStart={handleSettlingStart}
              onSettlingEnd={handleSettlingEnd}
              onDragActiveChange={handleDragActiveChange}
              layoutResetNonce={layoutResetNonce}
              dragActivationBlocked={dragActivationBlocked}
              initialEstimatedOffset={initialEstimatedOffsets[key]}
              dragStartSlop={dragStartSlop}
              itemSpringConfig={itemSpringConfig}
              dropAnimation={dropAnimation}
              dropTimingConfig={dropTimingConfig}
              dropSpringConfig={dropSpringConfig}
              activeScale={activeScale}
              child={renderItem({
                item,
                index,
                drag: () => {},
                isActive: false,
              })}
            />
          );
        })}
      </Animated.View>
      {ListFooterComponent}
    </View>
  );
}

const styles = StyleSheet.create({
  listContainer: {
    position: 'relative',
  },
  listClip: {
    overflow: 'hidden',
  },
  itemContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
  dragDisabledZone: {
    ...StyleSheet.absoluteFillObject,
  },
});
