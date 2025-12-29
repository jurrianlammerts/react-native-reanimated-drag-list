import React, { createContext, useContext, useMemo } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedReaction,
  useSharedValue,
  useAnimatedStyle,
  withSpring,
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

// ------------------------------------------------------------------
// CONFIGURATION
// ------------------------------------------------------------------
const AUTO_SCROLL_THRESHOLD = 100;
const AUTO_SCROLL_MAX_SPEED = 12;
const AUTO_SCROLL_MIN_SPEED = 1;
const AUTO_SCROLL_SMOOTHING = 0.15; // Lower = smoother transitions (0-1)
const DEFAULT_DRAG_ACTIVATION_DELAY = 200;
const SWAP_THRESHOLD = 0.5;
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
export function DragDisabledZone({ children }: { children: React.ReactNode }) {
  // Use a Native gesture to capture touches and prevent them from
  // bubbling up to the Pan gesture that activates drag
  const nativeGesture = Gesture.Native();

  return (
    <DragDisabledContext.Provider value={{ isDragDisabled: true }}>
      <GestureDetector gesture={nativeGesture}>
        <View>{children}</View>
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

export type NestableDraggableFlatListProps<T> = {
  data: T[];
  /** Fixed height for all items (optional - if not provided, heights are measured dynamically) */
  itemHeight?: number;
  /** Estimated item height for initial layout before measurement (default: 60) */
  estimatedItemHeight?: number;
  renderItem: (params: RenderItemParams<T>) => React.ReactNode;
  onDragEnd: (data: T[]) => void;
  keyExtractor: (item: T) => string;
  style?: ViewStyle;
  contentContainerStyle?: ViewStyle;
  dragActivationDelay?: number;
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
function getItemOffset(
  heights: Record<string, number>,
  positions: Record<string, number>,
  targetPosition: number,
  keys: string[],
  estimatedHeight: number
): number {
  'worklet';
  let offset = 0;
  for (let i = 0; i < targetPosition; i++) {
    const keyAtPosition = keys.find((k) => positions[k] === i);
    if (keyAtPosition) {
      offset += heights[keyAtPosition] ?? estimatedHeight;
    } else {
      offset += estimatedHeight;
    }
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
  estimatedHeight: number
): number {
  'worklet';
  let cumulative = 0;
  for (let i = 0; i < totalCount; i++) {
    const keyAtPosition = keys.find((k) => positions[k] === i);
    const height = keyAtPosition
      ? heights[keyAtPosition] ?? estimatedHeight
      : estimatedHeight;
    if (offset < cumulative + height) {
      return i;
    }
    cumulative += height;
  }
  return totalCount - 1;
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
  scrollY: SharedValue<number>;
  fixedItemHeight: number | undefined;
  estimatedItemHeight: number;
  totalCount: number;
  onDragFinalize: () => void;
  containerHeight: SharedValue<number>;
  containerTop: SharedValue<number>;
  contentHeight: SharedValue<number>;
  scrollViewRef: AnimatedRef<any>;
  dragActivationDelay: number;
  outerScrollEnabled: SharedValue<boolean>;
  autoScrollThreshold: number;
  autoScrollMaxSpeed: number;
  autoScrollMinSpeed: number;
  autoScrollSmoothing: number;
  allKeys: string[];
  onHeightMeasured: (id: string, height: number) => void;
};

const NestableDraggableItem = ({
  id,
  index,
  child,
  positions,
  heights,
  scrollY,
  fixedItemHeight,
  estimatedItemHeight,
  totalCount,
  onDragFinalize,
  containerHeight,
  containerTop,
  contentHeight,
  scrollViewRef,
  dragActivationDelay,
  outerScrollEnabled,
  autoScrollThreshold,
  autoScrollMaxSpeed,
  autoScrollMinSpeed,
  autoScrollSmoothing,
  allKeys,
  onHeightMeasured,
}: NestableDraggableItemProps) => {
  const isDragging = useSharedValue(false);
  // Track when item is settling to final position (prevents reaction interference)
  const isSettling = useSharedValue(false);

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
    return heights.value[itemId] ?? estimatedItemHeight;
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
      estimatedItemHeight
    );
  };

  // Sync position with index on mount and when not actively dragging
  useAnimatedReaction(
    () => ({
      pos: positions.value[id],
      h: heights.value,
    }),
    (current) => {
      if (!isDragging.value && !isSettling.value && current.pos !== undefined) {
        const targetOffset = calculateOffset(current.pos);
        top.value = targetOffset;
      }
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
      top.value = startTop.value + deltaY + deltaScroll;
    }
  });

  const pan = Gesture.Pan()
    .activateAfterLongPress(dragActivationDelay)
    .onStart((e: { absoluteY: number }) => {
      // Only set isDragging when gesture actually activates (after long press)
      isDragging.value = true;
      isSettling.value = false;
      // Reset scroll velocity for fresh start
      currentScrollVelocity.value = 0;
      // Disable outer scroll while dragging
      outerScrollEnabled.value = false;

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
    })
    .onUpdate((e: { absoluteY: number }) => {
      currentFingerY.value = e.absoluteY;

      const deltaY = e.absoluteY - startY.value;
      const deltaScroll = scrollY.value - startScrollY.value;
      top.value = startTop.value + deltaY + deltaScroll;

      const currentPosition = positions.value[id] ?? 0;
      const currentItemHeight = getItemHeight(id);
      const currentOffset = calculateOffset(currentPosition);
      const displacement = top.value - currentOffset;

      // Use dynamic threshold based on item heights
      const thresholdDistance = currentItemHeight * SWAP_THRESHOLD;

      if (Math.abs(displacement) > thresholdDistance) {
        // Find the position at the center of the dragged item
        const draggedCenter = top.value + currentItemHeight / 2;
        const targetPosition = getPositionAtOffset(
          heights.value,
          positions.value,
          draggedCenter,
          allKeys,
          totalCount,
          fixedItemHeight ?? estimatedItemHeight
        );

        const clampedTargetPosition = Math.max(
          0,
          Math.min(targetPosition, totalCount - 1)
        );

        if (clampedTargetPosition !== currentPosition) {
          const itemToSwapId = allKeys.find(
            (key) => positions.value[key] === clampedTargetPosition
          );

          if (itemToSwapId && itemToSwapId !== id) {
            const newPositions = { ...positions.value };
            newPositions[id] = clampedTargetPosition;
            newPositions[itemToSwapId] = currentPosition;
            positions.value = newPositions;
          }
        }
      }
    })
    .onFinalize(() => {
      // Only handle finalization if drag was actually started
      if (!isDragging.value) {
        return;
      }

      // Mark as settling before starting animation
      isSettling.value = true;
      isDragging.value = false;
      // Reset scroll velocity
      currentScrollVelocity.value = 0;

      const targetPosition = positions.value[id] ?? 0;
      const finalTop = calculateOffset(targetPosition);

      // Animate to final position with callback
      top.value = withSpring(
        finalTop,
        { damping: 40, stiffness: 350 },
        (finished) => {
          if (finished) {
            isSettling.value = false;
            runOnJS(onDragFinalize)();
          }
        }
      );

      // Re-enable outer scroll
      outerScrollEnabled.value = true;
    });

  // React to position changes from other items swapping
  useAnimatedReaction(
    () => positions.value[id],
    (currentPosition, previousPosition) => {
      // Only animate if:
      // - Position actually changed
      // - Not currently dragging this item
      // - Not settling from a drag
      // - Position is defined
      if (
        currentPosition !== previousPosition &&
        !isDragging.value &&
        !isSettling.value &&
        currentPosition !== undefined
      ) {
        const targetOffset = calculateOffset(currentPosition);
        top.value = withSpring(targetOffset, {
          damping: 40,
          stiffness: 350,
        });
      }
    }
  );

  const animatedStyle = useAnimatedStyle(() => {
    return {
      top: top.value,
      zIndex: isDragging.value ? 9999 : isSettling.value ? 9998 : 1,
      transform: [
        {
          scale: isDragging.value
            ? 1.05
            : withSpring(1, { damping: 40, stiffness: 350 }),
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
    <GestureDetector gesture={pan}>
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
  keyExtractor,
  style,
  contentContainerStyle,
  dragActivationDelay = DEFAULT_DRAG_ACTIVATION_DELAY,
  ListHeaderComponent,
  ListFooterComponent,
  autoScrollThreshold = AUTO_SCROLL_THRESHOLD,
  autoScrollMaxSpeed = AUTO_SCROLL_MAX_SPEED,
  autoScrollMinSpeed = AUTO_SCROLL_MIN_SPEED,
  autoScrollSmoothing = AUTO_SCROLL_SMOOTHING,
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

  const positions = useSharedValue<Record<string, number>>(
    Object.fromEntries(data.map((item, index) => [keyExtractor(item), index]))
  );

  // Track measured heights for dynamic sizing
  const heights = useSharedValue<Record<string, number>>({});

  // Calculate total list height
  const listContentHeight = useMemo(() => {
    if (fixedItemHeight !== undefined) {
      return data.length * fixedItemHeight;
    }
    // For dynamic heights, use estimated height initially
    // The actual height will be updated as items are measured
    return data.length * estimatedItemHeight;
  }, [data.length, fixedItemHeight, estimatedItemHeight]);

  // Track measured total height for dynamic lists
  const [measuredTotalHeight, setMeasuredTotalHeight] =
    React.useState(listContentHeight);

  // Update measured total height when heights change
  const updateTotalHeight = React.useCallback(() => {
    if (fixedItemHeight !== undefined) return;

    const currentHeights = heights.value;
    let total = 0;
    for (const key of allKeys) {
      total += currentHeights[key] ?? estimatedItemHeight;
    }
    setMeasuredTotalHeight(total);
  }, [allKeys, estimatedItemHeight, fixedItemHeight, heights]);

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

  // Update positions when data changes
  React.useEffect(() => {
    positions.value = Object.fromEntries(
      data.map((item, index) => [keyExtractor(item), index])
    );
  }, [data, keyExtractor, positions]);

  const handleDragFinalize = () => {
    const newOrder = new Array(data.length);
    const currentPositions = positions.value;

    data.forEach((item) => {
      const key = keyExtractor(item);
      const position = currentPositions[key];
      if (position !== undefined) {
        newOrder[position] = item;
      }
    });

    onDragEnd(newOrder);
  };

  const actualHeight =
    fixedItemHeight !== undefined ? listContentHeight : measuredTotalHeight;

  return (
    <View style={style}>
      {ListHeaderComponent}
      <View
        style={[
          styles.listContainer,
          contentContainerStyle,
          { height: actualHeight },
        ]}
      >
        {data.map((item, index) => {
          const key = keyExtractor(item);
          return (
            <NestableDraggableItem
              key={key}
              id={key}
              index={index}
              positions={positions}
              heights={heights}
              scrollY={scrollY}
              fixedItemHeight={fixedItemHeight}
              estimatedItemHeight={estimatedItemHeight}
              totalCount={data.length}
              onDragFinalize={handleDragFinalize}
              containerHeight={containerHeight}
              containerTop={containerTop}
              contentHeight={contentHeight}
              scrollViewRef={scrollViewRef}
              dragActivationDelay={dragActivationDelay}
              outerScrollEnabled={outerScrollEnabled}
              autoScrollThreshold={autoScrollThreshold}
              autoScrollMaxSpeed={autoScrollMaxSpeed}
              autoScrollMinSpeed={autoScrollMinSpeed}
              autoScrollSmoothing={autoScrollSmoothing}
              allKeys={allKeys}
              onHeightMeasured={handleHeightMeasured}
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
  itemContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
});
