import React from 'react';
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
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
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
  itemHeight: number;
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
// NESTABLE DRAGGABLE ITEM WRAPPER
// ------------------------------------------------------------------
type NestableDraggableItemProps = {
  id: string;
  index: number;
  child: React.ReactNode;
  positions: SharedValue<Record<string, number>>;
  scrollY: SharedValue<number>;
  itemHeight: number;
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
};

const NestableDraggableItem = ({
  id,
  index,
  child,
  positions,
  scrollY,
  itemHeight,
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
}: NestableDraggableItemProps) => {
  const isDragging = useSharedValue(false);
  // Track when item is settling to final position (prevents reaction interference)
  const isSettling = useSharedValue(false);
  const top = useSharedValue(index * itemHeight);

  const startY = useSharedValue(0);
  const startTop = useSharedValue(0);
  const startScrollY = useSharedValue(0);
  const currentFingerY = useSharedValue(0);
  // Smoothed scroll velocity for butter-smooth autoscroll
  const currentScrollVelocity = useSharedValue(0);

  // Sync position with index on mount and when not actively dragging
  useAnimatedReaction(
    () => index,
    (currentIndex) => {
      if (!isDragging.value && !isSettling.value) {
        top.value = currentIndex * itemHeight;
      }
    },
    [index, itemHeight]
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
      const currentIndex = positions.value[id] ?? 0;
      startTop.value = currentIndex * itemHeight;
      // Ensure we start from the correct position
      top.value = startTop.value;
    })
    .onUpdate((e: { absoluteY: number }) => {
      currentFingerY.value = e.absoluteY;

      const deltaY = e.absoluteY - startY.value;
      const deltaScroll = scrollY.value - startScrollY.value;
      top.value = startTop.value + deltaY + deltaScroll;

      const currentIndex = positions.value[id] ?? 0;
      const currentTop = currentIndex * itemHeight;
      const displacement = top.value - currentTop;
      const thresholdDistance = itemHeight * SWAP_THRESHOLD;

      if (Math.abs(displacement) > thresholdDistance) {
        const targetIndex =
          displacement > 0 ? currentIndex + 1 : currentIndex - 1;
        const clampedTargetIndex = Math.max(
          0,
          Math.min(targetIndex, totalCount - 1)
        );

        if (clampedTargetIndex !== currentIndex) {
          const objectKeys = Object.keys(positions.value);
          const itemToSwapId = objectKeys.find(
            (key) => positions.value[key] === clampedTargetIndex
          );

          if (itemToSwapId && itemToSwapId !== id) {
            const newPositions = { ...positions.value };
            newPositions[id] = clampedTargetIndex;
            newPositions[itemToSwapId] = currentIndex;
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

      const targetIndex = positions.value[id] ?? 0;
      const finalTop = targetIndex * itemHeight;

      // Animate to final position with callback
      top.value = withSpring(
        finalTop,
        { damping: 40, stiffness: 350 },
        (finished) => {
          if (finished) {
            isSettling.value = false;
            scheduleOnRN(onDragFinalize);
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
        top.value = withSpring(currentPosition * itemHeight, {
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

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        style={[styles.itemContainer, { height: itemHeight }, animatedStyle]}
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
  itemHeight,
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

  const positions = useSharedValue<Record<string, number>>(
    Object.fromEntries(data.map((item, index) => [keyExtractor(item), index]))
  );

  const listContentHeight = data.length * itemHeight;

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
      const index = currentPositions[key];
      if (index !== undefined) {
        newOrder[index] = item;
      }
    });

    onDragEnd(newOrder);
  };

  return (
    <View style={style}>
      {ListHeaderComponent}
      <View
        style={[
          styles.listContainer,
          contentContainerStyle,
          { height: listContentHeight },
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
              scrollY={scrollY}
              itemHeight={itemHeight}
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
