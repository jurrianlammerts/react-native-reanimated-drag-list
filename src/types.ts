import type { ViewStyle } from 'react-native';
import type { SharedValue, AnimatedRef } from 'react-native-reanimated';

// ------------------------------------------------------------------
// RENDER ITEM PARAMS
// ------------------------------------------------------------------
export type RenderItemParams<T> = {
  item: T;
  drag: () => void; // Function the user calls to initiate drag (if using a handle)
  isActive: boolean;
  index: number;
};

// ------------------------------------------------------------------
// DRAGGABLE LIST PROPS
// ------------------------------------------------------------------
export type DraggableListProps<T> = {
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
// DRAGGABLE ITEM PROPS
// ------------------------------------------------------------------
export type DraggableItemProps = {
  id: string;
  index: number;
  child: React.ReactNode;
  positions: SharedValue<Record<string, number>>;
  scrollY: SharedValue<number>;
  itemHeight: number;
  totalCount: number;
  onDragFinalize: () => void;
  containerHeight: SharedValue<number>;
  /** Y position of container on screen - for relative auto-scroll calculation */
  containerTop: SharedValue<number>;
  contentHeight: number;
  scrollViewRef: AnimatedRef<any>;
  dragActivationDelay: number;
};
