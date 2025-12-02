import React from 'react';
import { StyleSheet, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedReaction,
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

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
};

const DraggableItem = ({
  id,
  child,
  positions,
  scrollY,
  itemHeight,
  totalCount,
  onDragFinalize,
}: DraggableItemProps) => {
  const isDragging = useSharedValue(false);
  const top = useSharedValue((positions.value[id] ?? 0) * itemHeight);

  // We expose a drag handle if needed, but for this implementation
  // we attach the gesture to the whole row.
  const pan = Gesture.Pan()
    .onBegin(() => {
      isDragging.value = true;
    })
    .onUpdate((e: { absoluteY: number }) => {
      // Logic: Absolute position + Scroll Offset - Half Item Height
      // Note: We might need to adjust 'absoluteY' logic depending on header height in real apps
      // For a library, usually better to use 'translationY' + initial offset,
      // but sticking to your requested architecture:
      top.value = e.absoluteY + scrollY.value - itemHeight / 2;

      const newIndex = Math.floor((top.value + itemHeight / 2) / itemHeight);
      const clampedIndex = Math.max(0, Math.min(newIndex, totalCount - 1));

      if (clampedIndex !== positions.value[id]) {
        const objectKeys = Object.keys(positions.value);
        const itemToSwapId = objectKeys.find(
          (key) => positions.value[key] === clampedIndex
        );

        if (itemToSwapId && itemToSwapId !== id) {
          const oldIndex = positions.value[id] ?? 0;
          const newPositions = { ...positions.value };
          newPositions[id] = clampedIndex;
          newPositions[itemToSwapId] = oldIndex;
          positions.value = newPositions;
        }
      }
    })
    .onFinalize(() => {
      const targetIndex = positions.value[id] ?? 0;
      const finalTop = targetIndex * itemHeight;
      top.value = withSpring(finalTop, { damping: 15, stiffness: 150 });
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
    transform: [{ scale: withSpring(isDragging.value ? 1.05 : 1) }],
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
}: DraggableListProps<T>) {
  // Initialize positions map
  const positions = useSharedValue<Record<string, number>>(
    Object.fromEntries(data.map((item, index) => [keyExtractor(item), index]))
  );

  const scrollY = useSharedValue(0);

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

  return (
    <Animated.ScrollView
      onScroll={onScroll}
      scrollEventThrottle={16}
      style={style}
      contentContainerStyle={[
        contentContainerStyle,
        styles.container,
        { height: data.length * itemHeight },
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
