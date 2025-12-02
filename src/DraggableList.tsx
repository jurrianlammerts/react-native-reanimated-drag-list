import { StyleSheet, type LayoutChangeEvent } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedRef,
  measure,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { DraggableItem } from './DraggableItem';
import type { DraggableListProps } from './types';
import { DEFAULT_DRAG_ACTIVATION_DELAY } from './constants';

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
  const containerTop = useSharedValue(0);
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
    // Measure the container's position on screen using reanimated
    scheduleOnRN(() => {
      const measurement = measure(scrollViewRef);
      if (measurement) {
        containerTop.value = measurement.pageY;
      }
    });
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
            containerTop={containerTop}
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
});
