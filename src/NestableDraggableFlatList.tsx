import React, { createContext, useContext, useMemo } from 'react';
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

// ------------------------------------------------------------------
// CONFIGURATION
// ------------------------------------------------------------------
const AUTO_SCROLL_THRESHOLD = 160;
const AUTO_SCROLL_MAX_SPEED = 20;
const AUTO_SCROLL_MIN_SPEED = 1;
const AUTO_SCROLL_SMOOTHING = 0.28; // Lower = smoother transitions (0-1)
const DEFAULT_DRAG_ACTIVATION_DELAY = 200;
const SWAP_THRESHOLD = 0.5;
const MAX_SWAPS_PER_UPDATE = 3;
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
  /** When true, rows matching this predicate cannot be dragged or swapped with */
  isItemLocked?: (item: T, index: number) => boolean;
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

function getItemOffset(
  heights: Record<string, number>,
  positions: Record<string, number>,
  targetPosition: number,
  keys: string[],
  estimatedHeights: Record<string, number>,
  fallbackEstimated: number
): number {
  'worklet';
  let offset = 0;
  for (let i = 0; i < targetPosition; i++) {
    const keyAtPosition = keys.find((k) => positions[k] === i);
    offset += getHeightForKey(
      keyAtPosition,
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
  let cumulative = 0;
  for (let i = 0; i < totalCount; i++) {
    const keyAtPosition = keys.find((k) => positions[k] === i);
    const height = getHeightForKey(
      keyAtPosition,
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

function swapOneStepTowardTarget(
  id: string,
  targetPosition: number,
  positions: Record<string, number>,
  allKeys: string[],
  totalCount: number,
  lockedKeys: Record<string, boolean>
): Record<string, number> {
  'worklet';
  const currentPosition = positions[id] ?? 0;
  const clampedTarget = Math.max(0, Math.min(targetPosition, totalCount - 1));

  if (currentPosition === clampedTarget) {
    return positions;
  }

  const direction: 1 | -1 = currentPosition < clampedTarget ? 1 : -1;
  const nextPosition = findNextUnlockedPosition(
    currentPosition,
    direction,
    totalCount,
    positions,
    lockedKeys,
    allKeys
  );

  if (nextPosition === null) {
    return positions;
  }

  const itemToSwapId = allKeys.find((key) => positions[key] === nextPosition);

  if (!itemToSwapId || itemToSwapId === id || lockedKeys[itemToSwapId]) {
    return positions;
  }

  const newPositions = { ...positions };
  newPositions[id] = nextPosition;
  newPositions[itemToSwapId] = currentPosition;
  return newPositions;
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
  lockedKeys: Record<string, boolean>
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

  const clampedTarget = Math.max(0, Math.min(targetPosition, totalCount - 1));

  let nextPositions = positions;
  let guard = 0;
  let activePosition = nextPositions[id] ?? 0;

  while (activePosition !== clampedTarget && guard < totalCount) {
    nextPositions = swapOneStepTowardTarget(
      id,
      clampedTarget,
      nextPositions,
      allKeys,
      totalCount,
      lockedKeys
    );
    const updatedPosition = nextPositions[id] ?? 0;
    if (updatedPosition === activePosition) {
      break;
    }
    activePosition = updatedPosition;
    guard += 1;
  }

  return nextPositions;
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
  activeDragCount: SharedValue<number>;
  isLocked: boolean;
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
  onHeightMeasured: (id: string, height: number) => void;
  swapThreshold: number;
  onDragStart?: (info: { key: string; index: number }) => void;
  onSettlingStart?: () => void;
  onSettlingEnd?: () => void;
  onDragActiveChange?: (active: boolean) => void;
} & ItemAnimationConfig;

const NestableDraggableItem = ({
  id,
  index,
  child,
  positions,
  heights,
  estimatedHeights,
  lockedKeys,
  activeDragCount,
  isLocked,
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
  onHeightMeasured,
  swapThreshold,
  onDragStart,
  onSettlingStart,
  onSettlingEnd,
  onDragActiveChange,
  itemSpringConfig = DEFAULT_ITEM_SPRING,
  dropAnimation = 'timing',
  dropTimingConfig = DEFAULT_DROP_TIMING,
  dropSpringConfig = LEGACY_DROP_SPRING,
  activeScale = DEFAULT_ACTIVE_SCALE,
}: NestableDraggableItemProps) => {
  const isDragging = useSharedValue(false);
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

  // Calculate initial offset
  const initialOffset = useMemo(() => {
    if (fixedItemHeight !== undefined) {
      return index * fixedItemHeight;
    }
    // For dynamic heights, start at estimated position
    return index * estimatedItemHeight;
  }, [index, fixedItemHeight, estimatedItemHeight]);

  const top = useSharedValue(initialOffset);

  const startY = useSharedValue(0);
  const startTop = useSharedValue(0);
  const startScrollY = useSharedValue(0);
  const currentFingerY = useSharedValue(0);
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

    if (activeDragCount.value > 0) {
      top.value = targetOffset;
      return;
    }

    if (positionChanged && animate) {
      top.value = withSpring(targetOffset, itemSpringConfig);
      return;
    }

    top.value = targetOffset;
  };

  // Sync top when slot, neighbor layout, or measured heights change
  useAnimatedReaction(
    () => ({
      pos: positions.value[id],
      h: heights.value,
      dragCount: activeDragCount.value,
      positions: positions.value,
    }),
    (current, previous) => {
      if (current.pos === undefined) {
        return;
      }
      const previousPos = previous?.pos;
      const positionChanged =
        previousPos !== undefined && current.pos !== previousPos;
      const layoutChanged =
        previous?.positions !== undefined &&
        current.positions !== previous.positions;

      // Locked headers (and other rows whose slot index is unchanged) still
      // need Y updates when neighbors swap, because offset is cumulative.
      if (current.dragCount > 0 && layoutChanged && !isDragging.value) {
        top.value = calculateOffset(current.pos);
        return;
      }

      const shouldAnimate = positionChanged && current.dragCount === 0;
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

  // Continuous auto-scroll using frame callback with velocity smoothing
  useFrameCallback(() => {
    if (!isDragging.value) {
      // Smoothly decay velocity when not dragging
      currentScrollVelocity.value = lerp(currentScrollVelocity.value, 0, 0.3);
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
      top.value = clampDragTop(
        rawTop,
        getItemHeight(id),
        listHeight.value,
        clampDragToBounds
      );
    }
  });

  const pan = Gesture.Pan()
    .enabled(!isLocked)
    .activateAfterLongPress(dragActivationDelay)
    .onStart((e: { absoluteY: number }) => {
      if (lockedKeys.value[id]) {
        return;
      }
      // Only set isDragging when gesture actually activates (after long press)
      isDragging.value = true;
      isSettling.value = false;
      // Reset scroll velocity for fresh start
      currentScrollVelocity.value = 0;
      // Disable outer scroll while dragging
      outerScrollEnabled.value = false;

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
      // Ensure we start from the correct position
      top.value = startTop.value;

      if (onDragStart) {
        runOnJS(onDragStart)({ key: id, index });
      }
    })
    .onUpdate((e: { absoluteY: number }) => {
      currentFingerY.value = e.absoluteY;

      const deltaY = e.absoluteY - startY.value;
      const deltaScroll = scrollY.value - startScrollY.value;
      const rawTop = startTop.value + deltaY + deltaScroll;
      top.value = clampDragTop(
        rawTop,
        getItemHeight(id),
        listHeight.value,
        clampDragToBounds
      );

      const currentPosition = positions.value[id] ?? 0;
      const currentItemHeight = getItemHeight(id);
      const currentOffset = calculateOffset(currentPosition);
      const displacement = top.value - currentOffset;

      // Use dynamic threshold based on item heights
      const thresholdDistance = currentItemHeight * swapThreshold;

      if (Math.abs(displacement) > thresholdDistance) {
        const draggedCenter = top.value + currentItemHeight / 2;
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

        const clampedTargetPosition = Math.max(
          0,
          Math.min(targetPosition, totalCount - 1)
        );

        let activePosition = currentPosition;
        let swapGuard = 0;

        while (
          swapGuard < MAX_SWAPS_PER_UPDATE &&
          clampedTargetPosition !== activePosition
        ) {
          const nextPositions = swapOneStepTowardTarget(
            id,
            clampedTargetPosition,
            positions.value,
            allKeys,
            totalCount,
            lockedKeys.value
          );
          const updatedPosition = nextPositions[id] ?? 0;

          if (updatedPosition === activePosition) {
            break;
          }

          positions.value = nextPositions;
          activePosition = updatedPosition;
          swapGuard += 1;

          const newOffset = calculateOffset(activePosition);
          const newDisplacement = top.value - newOffset;

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
        top.value,
        getItemHeight,
        heights.value,
        positions.value,
        allKeys,
        totalCount,
        estimatedHeights.value,
        estimatedItemHeight,
        lockedKeys.value
      );

      // Mark as settling before starting animation
      isSettling.value = true;
      isDragging.value = false;
      // Reset scroll velocity
      currentScrollVelocity.value = 0;

      if (onDragActiveChange) {
        runOnJS(onDragActiveChange)(false);
      }

      if (onSettlingStart) {
        runOnJS(onSettlingStart)();
      }

      const targetPosition = positions.value[id] ?? 0;
      const finalTop = calculateOffset(targetPosition);

      const onDropFinished = (finished?: boolean) => {
        'worklet';
        if (finished === false || finished === true) {
          runOnJS(finalizeDrag)();
        }
      };

      if (dropAnimation === 'spring') {
        top.value = withSpring(finalTop, dropSpringConfig, onDropFinished);
      } else {
        top.value = withTiming(finalTop, dropTimingConfig, onDropFinished);
      }

      // Re-enable outer scroll
      outerScrollEnabled.value = true;
    });

  const animatedStyle = useAnimatedStyle(() => {
    return {
      top: top.value,
      zIndex: isDragging.value ? 9999 : isSettling.value ? 9998 : 1,
      transform: [
        {
          scale: isDragging.value
            ? activeScale
            : withSpring(1, itemSpringConfig),
        },
      ],
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
    <GestureDetector gesture={isLocked ? Gesture.Native() : pan}>
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
  isItemLocked,
  clampDragToBounds = true,
  clipWhileDragging = true,
  getEstimatedItemHeight,
  ListHeaderComponent,
  ListFooterComponent,
  autoScrollThreshold = AUTO_SCROLL_THRESHOLD,
  autoScrollMaxSpeed = AUTO_SCROLL_MAX_SPEED,
  autoScrollMinSpeed = AUTO_SCROLL_MIN_SPEED,
  autoScrollSmoothing = AUTO_SCROLL_SMOOTHING,
  itemSpringConfig,
  dropAnimation,
  dropTimingConfig,
  dropSpringConfig,
  activeScale,
}: NestableDraggableFlatListProps<T>) {
  const {
    scrollY,
    containerHeight,
    containerTop,
    scrollViewRef,
    outerScrollEnabled,
    contentHeight,
  } = useNestableScrollContainerContext();

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

  const activeDragCount = useSharedValue(0);

  React.useEffect(() => {
    lockedKeys.value = lockedKeysMap;
  }, [lockedKeys, lockedKeysMap]);

  React.useEffect(() => {
    estimatedHeights.value = estimatedHeightsMap;
  }, [estimatedHeights, estimatedHeightsMap]);

  const positions = useSharedValue<Record<string, number>>(
    Object.fromEntries(data.map((item, index) => [keyExtractor(item), index]))
  );

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

  // Track measured total height for dynamic lists
  const [measuredTotalHeight, setMeasuredTotalHeight] =
    React.useState(listContentHeight);
  const [blockPositionReset, setBlockPositionReset] = React.useState(false);
  const [isDraggingActive, setIsDraggingActive] = React.useState(false);
  const activeDragCountRef = React.useRef(0);

  const listHeight = useSharedValue(listContentHeight);

  React.useEffect(() => {
    listHeight.value = measuredTotalHeight;
  }, [listHeight, measuredTotalHeight]);

  const handleDragActiveChange = React.useCallback(
    (active: boolean) => {
      if (active) {
        activeDragCount.value += 1;
        activeDragCountRef.current += 1;
        setIsDraggingActive(true);
        return;
      }
      activeDragCount.value = Math.max(0, activeDragCount.value - 1);
      activeDragCountRef.current = Math.max(0, activeDragCountRef.current - 1);
      if (activeDragCountRef.current === 0) {
        setIsDraggingActive(false);
      }
    },
    [activeDragCount]
  );

  const handleSettlingStart = React.useCallback(() => {
    setBlockPositionReset(true);
  }, []);

  const handleSettlingEnd = React.useCallback(() => {
    setBlockPositionReset(false);
  }, []);

  // Update measured total height when heights change
  const updateTotalHeight = React.useCallback(() => {
    if (fixedItemHeight !== undefined) return;

    const currentHeights = heights.value;
    let total = 0;
    for (const key of allKeys) {
      total +=
        currentHeights[key] ?? estimatedHeightsMap[key] ?? estimatedItemHeight;
    }
    setMeasuredTotalHeight(total);
  }, [
    allKeys,
    estimatedHeightsMap,
    estimatedItemHeight,
    fixedItemHeight,
    heights,
  ]);

  // Handle height measurement from items
  const handleHeightMeasured = React.useCallback(
    (id: string, height: number) => {
      const currentHeight = heights.value[id];
      if (currentHeight !== height) {
        // Update on UI thread
        runOnUI(() => {
          heights.value = { ...heights.value, [id]: height };
        })();
        // Update total height on JS thread
        setTimeout(updateTotalHeight, 0);
      }
    },
    [heights, updateTotalHeight]
  );

  // Reset positions when key order or membership changes (e.g. external reorder)
  React.useEffect(() => {
    if (blockPositionReset) {
      return;
    }

    positions.value = Object.fromEntries(
      data.map((item, index) => [keyExtractor(item), index])
    );
  }, [dataKeySequence, data, keyExtractor, positions, blockPositionReset]);

  const handleDragFinalize = () => {
    const currentPositions = positions.value;
    onDragEnd(buildDenseOrder(data, currentPositions, keyExtractor));
  };

  const actualHeight =
    fixedItemHeight !== undefined ? listContentHeight : measuredTotalHeight;

  const listOverflowStyle =
    clipWhileDragging && isDraggingActive ? styles.listClip : undefined;

  return (
    <View style={style}>
      {ListHeaderComponent}
      <View
        style={[
          styles.listContainer,
          listOverflowStyle,
          contentContainerStyle,
          { height: actualHeight },
        ]}
      >
        {data.map((item, index) => {
          const key = keyExtractor(item);
          const isLocked = lockedKeysMap[key] ?? false;
          return (
            <NestableDraggableItem
              key={key}
              id={key}
              index={index}
              positions={positions}
              heights={heights}
              estimatedHeights={estimatedHeights}
              lockedKeys={lockedKeys}
              activeDragCount={activeDragCount}
              isLocked={isLocked}
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
              onHeightMeasured={handleHeightMeasured}
              swapThreshold={swapThreshold}
              onDragStart={onDragStart}
              onSettlingStart={handleSettlingStart}
              onSettlingEnd={handleSettlingEnd}
              onDragActiveChange={handleDragActiveChange}
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
      </View>
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
