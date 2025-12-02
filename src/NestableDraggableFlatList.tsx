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
}: NestableDraggableItemProps) => {
  const isDragging = useSharedValue(false);
  // Track when item is settling to final position (prevents reaction interference)
  const isSettling = useSharedValue(false);
  const top = useSharedValue(index * itemHeight);

  const startY = useSharedValue(0);
  const startTop = useSharedValue(0);
  const startScrollY = useSharedValue(0);
  const currentFingerY = useSharedValue(0);
  const previousFingerY = useSharedValue(0);
  const movementDirection = useSharedValue(0); // -1 = up, 0 = none, 1 = down

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

  // Calculate progressive scroll speed with exponential curve
  // Closer to edge = faster scroll (exponential ramp up)
  const getProgressiveSpeed = (distanceFromEdge: number) => {
    'worklet';
    // Normalize distance: 0 = at edge, 1 = at threshold boundary
    const normalizedDistance = Math.min(
      1,
      Math.max(0, distanceFromEdge / AUTO_SCROLL_THRESHOLD)
    );
    // Use exponential curve (power of 3) for aggressive acceleration near edge
    // At edge (0): speed = MAX, at threshold (1): speed = MIN
    const easedProgress = Math.pow(1 - normalizedDistance, 3);
    return (
      AUTO_SCROLL_MIN_SPEED +
      (AUTO_SCROLL_MAX_SPEED - AUTO_SCROLL_MIN_SPEED) * easedProgress
    );
  };

  // Continuous auto-scroll using frame callback
  useFrameCallback(() => {
    if (!isDragging.value) return;

    // Calculate finger position relative to the container (not the screen)
    const relativeFingerY = currentFingerY.value - containerTop.value;
    const distanceFromTop = relativeFingerY;
    const distanceFromBottom = containerHeight.value - relativeFingerY;
    const maxScroll = Math.max(0, contentHeight.value - containerHeight.value);

    let scrollDelta = 0;

    // Only scroll up if:
    // - Finger is in the top threshold zone (relative to container)
    // - User is moving upward (movementDirection < 0)
    // - There's room to scroll up
    const isMovingUp = movementDirection.value < 0;
    const isMovingDown = movementDirection.value > 0;

    if (
      distanceFromTop < AUTO_SCROLL_THRESHOLD &&
      distanceFromTop >= 0 &&
      scrollY.value > 0 &&
      isMovingUp
    ) {
      scrollDelta = -getProgressiveSpeed(distanceFromTop);
    } else if (
      distanceFromBottom < AUTO_SCROLL_THRESHOLD &&
      distanceFromBottom >= 0 &&
      scrollY.value < maxScroll &&
      isMovingDown
    ) {
      // Only scroll down if:
      // - Finger is in the bottom threshold zone (relative to container)
      // - User is moving downward (movementDirection > 0)
      // - There's room to scroll down
      scrollDelta = getProgressiveSpeed(distanceFromBottom);
    }

    if (scrollDelta !== 0) {
      const newScroll = Math.max(
        0,
        Math.min(maxScroll, scrollY.value + scrollDelta)
      );
      scrollTo(scrollViewRef, 0, newScroll, false);

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
      movementDirection.value = 0;
      // Disable outer scroll while dragging
      outerScrollEnabled.value = false;

      startY.value = e.absoluteY;
      startScrollY.value = scrollY.value;
      currentFingerY.value = e.absoluteY;
      previousFingerY.value = e.absoluteY;
      const currentIndex = positions.value[id] ?? 0;
      startTop.value = currentIndex * itemHeight;
      // Ensure we start from the correct position
      top.value = startTop.value;
    })
    .onUpdate((e: { absoluteY: number }) => {
      // Calculate movement direction based on finger movement
      const deltaFromPrevious = e.absoluteY - previousFingerY.value;
      // Use a small threshold to avoid jitter from minor movements
      const DIRECTION_THRESHOLD = 2;
      if (deltaFromPrevious > DIRECTION_THRESHOLD) {
        movementDirection.value = 1; // Moving down
      } else if (deltaFromPrevious < -DIRECTION_THRESHOLD) {
        movementDirection.value = -1; // Moving up
      }
      // Don't reset to 0 if within threshold - keep last direction

      previousFingerY.value = currentFingerY.value;
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
    const isActive = isDragging.value || isSettling.value;
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
      shadowColor: '#000',
      shadowOffset: { width: 0, height: isDragging.value ? 8 : 0 },
      shadowOpacity: isDragging.value ? 0.3 : 0,
      shadowRadius: isDragging.value ? 12 : 0,
      elevation: isActive ? 10 : 0,
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
