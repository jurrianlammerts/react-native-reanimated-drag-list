import React from 'react';
import {
  StyleSheet,
  type ViewStyle,
  type LayoutChangeEvent,
} from 'react-native';
import Animated, {
  useAnimatedReaction,
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  type SharedValue,
  useAnimatedRef,
  scrollTo,
  type AnimatedRef,
  useFrameCallback,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

// ------------------------------------------------------------------
// CONFIGURATION
// ------------------------------------------------------------------
const AUTO_SCROLL_THRESHOLD = 100; // pixels from edge to trigger auto-scroll
const AUTO_SCROLL_MAX_SPEED = 12; // max pixels per frame at edge
const AUTO_SCROLL_MIN_SPEED = 1; // min pixels per frame at threshold boundary
const DEFAULT_DRAG_ACTIVATION_DELAY = 200; // ms to hold before drag activates
const SWAP_THRESHOLD = 0.5; // percentage of item height needed to trigger swap

// ------------------------------------------------------------------
// TYPES
// ------------------------------------------------------------------
export type RenderItemParams<T> = {
  item: T;
  drag: () => void; // Function the user calls to initiate drag (if using a handle)
  isActive: boolean;
  index: number;
};

type DraggableListProps<T> = {
  data: T[];
  itemHeight: number;
  renderItem: (params: RenderItemParams<T>) => React.ReactNode;
  onDragEnd: (data: T[]) => void;
  keyExtractor: (item: T) => string;
  style?: ViewStyle;
  contentContainerStyle?: ViewStyle;
  /** Time in ms to hold before drag activates. Default: 200ms */
  dragActivationDelay?: number;
};

// ------------------------------------------------------------------
// DRAGGABLE ITEM WRAPPER
// ------------------------------------------------------------------
type DraggableItemProps = {
  id: string;
  index: number;
  child: React.ReactNode;
  positions: SharedValue<Record<string, number>>;
  scrollY: SharedValue<number>;
  itemHeight: number;
  totalCount: number;
  onDragFinalize: () => void;
  containerHeight: SharedValue<number>;
  contentHeight: number;
  scrollViewRef: AnimatedRef<any>;
  dragActivationDelay: number;
};

const DraggableItem = ({
  id,
  index,
  child,
  positions,
  scrollY,
  itemHeight,
  totalCount,
  onDragFinalize,
  containerHeight,
  contentHeight,
  scrollViewRef,
  dragActivationDelay,
}: DraggableItemProps) => {
  const isDragging = useSharedValue(false);
  // Use index prop for initial value to avoid reading shared value during render
  const top = useSharedValue(index * itemHeight);

  // Track initial positions when drag starts
  const startY = useSharedValue(0);
  const startTop = useSharedValue(0);
  const startScrollY = useSharedValue(0);

  // Track current finger position for continuous auto-scroll
  const currentFingerY = useSharedValue(0);

  // Continuous auto-scroll using frame callback
  useFrameCallback(() => {
    if (!isDragging.value) return;

    const distanceFromTop = currentFingerY.value;
    const distanceFromBottom = containerHeight.value - currentFingerY.value;
    const maxScroll = Math.max(0, contentHeight - containerHeight.value);

    let scrollDelta = 0;

    if (distanceFromTop < AUTO_SCROLL_THRESHOLD && scrollY.value > 0) {
      // Scroll up - speed increases as we get closer to edge
      const speed = interpolate(
        distanceFromTop,
        [0, AUTO_SCROLL_THRESHOLD],
        [AUTO_SCROLL_MAX_SPEED, AUTO_SCROLL_MIN_SPEED],
        Extrapolation.CLAMP
      );
      scrollDelta = -speed;
    } else if (
      distanceFromBottom < AUTO_SCROLL_THRESHOLD &&
      scrollY.value < maxScroll
    ) {
      // Scroll down - speed increases as we get closer to edge
      const speed = interpolate(
        distanceFromBottom,
        [0, AUTO_SCROLL_THRESHOLD],
        [AUTO_SCROLL_MAX_SPEED, AUTO_SCROLL_MIN_SPEED],
        Extrapolation.CLAMP
      );
      scrollDelta = speed;
    }

    if (scrollDelta !== 0) {
      const newScroll = Math.max(
        0,
        Math.min(maxScroll, scrollY.value + scrollDelta)
      );
      scrollTo(scrollViewRef, 0, newScroll, false);

      // Update item position to follow the auto-scroll
      const deltaY = currentFingerY.value - startY.value;
      const deltaScroll = newScroll - startScrollY.value;
      top.value = startTop.value + deltaY + deltaScroll;
    }
  });

  // Drag activates after holding for the specified delay, allowing scroll otherwise
  const pan = Gesture.Pan()
    .activateAfterLongPress(dragActivationDelay)
    .onBegin(() => {
      isDragging.value = true;
    })
    .onStart((e: { absoluteY: number }) => {
      // Capture initial positions when drag becomes active
      startY.value = e.absoluteY;
      startScrollY.value = scrollY.value;
      currentFingerY.value = e.absoluteY;
      const currentIndex = positions.value[id] ?? 0;
      startTop.value = currentIndex * itemHeight;
    })
    .onUpdate((e: { absoluteY: number }) => {
      // Update current finger position for auto-scroll
      currentFingerY.value = e.absoluteY;

      // Calculate position based on movement from start position
      const deltaY = e.absoluteY - startY.value;
      const deltaScroll = scrollY.value - startScrollY.value;
      top.value = startTop.value + deltaY + deltaScroll;

      // Calculate displacement from current position to determine swap
      const currentIndex = positions.value[id] ?? 0;
      const currentTop = currentIndex * itemHeight;
      const displacement = top.value - currentTop;
      const thresholdDistance = itemHeight * SWAP_THRESHOLD;

      // Only swap if we've moved past the threshold
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
      const targetIndex = positions.value[id] ?? 0;
      const finalTop = targetIndex * itemHeight;
      top.value = withSpring(finalTop, { damping: 30, stiffness: 300 });
      isDragging.value = false;
      scheduleOnRN(onDragFinalize);
    });

  useAnimatedReaction(
    () => positions.value[id],
    (currentPosition, previousPosition) => {
      if (
        currentPosition !== previousPosition &&
        !isDragging.value &&
        currentPosition !== undefined
      ) {
        top.value = withTiming(currentPosition * itemHeight, { duration: 300 });
      }
    }
  );

  const animatedStyle = useAnimatedStyle(() => ({
    top: top.value,
    zIndex: isDragging.value ? 9999 : 1,
    transform: [
      {
        scale: withSpring(isDragging.value ? 1.05 : 1, {
          damping: 30,
          stiffness: 300,
        }),
      },
    ],
  }));

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
// MAIN EXPORT
// ------------------------------------------------------------------
export function DraggableList<T extends { id?: string | number }>({
  data,
  itemHeight,
  renderItem,
  onDragEnd,
  keyExtractor,
  style,
  contentContainerStyle,
  dragActivationDelay = DEFAULT_DRAG_ACTIVATION_DELAY,
}: DraggableListProps<T>) {
  // Initialize positions map
  const positions = useSharedValue<Record<string, number>>(
    Object.fromEntries(data.map((item, index) => [keyExtractor(item), index]))
  );

  const scrollY = useSharedValue(0);
  const containerHeight = useSharedValue(0);
  const scrollViewRef = useAnimatedRef<any>();
  const contentHeight = data.length * itemHeight;

  const handleDragFinalize = () => {
    // Reconstruct the array based on the shared value positions
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

  const onScroll = (e: any) => {
    scrollY.value = e.nativeEvent.contentOffset.y;
  };

  const onLayout = (e: LayoutChangeEvent) => {
    containerHeight.value = e.nativeEvent.layout.height;
  };

  return (
    <Animated.ScrollView
      ref={scrollViewRef}
      onScroll={onScroll}
      onLayout={onLayout}
      scrollEventThrottle={16}
      style={style}
      contentContainerStyle={[
        contentContainerStyle,
        styles.container,
        { height: contentHeight },
      ]}
    >
      {data.map((item, index) => {
        const key = keyExtractor(item);
        return (
          <DraggableItem
            key={key}
            id={key}
            index={index}
            positions={positions}
            scrollY={scrollY}
            itemHeight={itemHeight}
            totalCount={data.length}
            onDragFinalize={handleDragFinalize}
            containerHeight={containerHeight}
            contentHeight={contentHeight}
            scrollViewRef={scrollViewRef}
            dragActivationDelay={dragActivationDelay}
            child={renderItem({
              item,
              index,
              drag: () => {}, // In this simple version, drag is automatic on touch
              isActive: false, // You could wire this up via shared value if needed
            })}
          />
        );
      })}
    </Animated.ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
  },
  itemContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
});
