# react-native-reanimated-drag-list

A high-performance draggable list component for React Native, built with Reanimated 4 and Gesture Handler. Runs entirely on the UI thread for buttery smooth 60fps animations.

## Features

- 🚀 **UI Thread Performance** - All animations run on the UI thread via Reanimated
- 📜 **Progressive Auto-scroll** - Automatically scrolls when dragging near edges with exponential speed curve
- ⏱️ **Long Press Activation** - Hold to drag, tap to scroll - configurable delay
- 🎯 **Smooth Animations** - Tuned swap springs and timing-based drop settle (no overshoot)
- 📱 **Fabric Ready** - Built for the new React Native architecture
- 🪆 **Nestable Lists** - Multiple draggable lists within a single scrollable container
- 📏 **Dynamic Heights** - Support for items with variable heights
- 🚫 **Drag Disabled Zones** - Exclude interactive elements from triggering drag

## Requirements

- React Native 0.71+
- react-native-reanimated 4.x
- react-native-gesture-handler 2.x
- react-native-worklets

## Installation

```sh
npm install react-native-reanimated-drag-list
```

Make sure you have the peer dependencies installed:

```sh
npm install react-native-reanimated react-native-gesture-handler react-native-worklets
```

## Usage

### Basic Usage

```tsx
import { DraggableList, type RenderItemParams } from 'react-native-reanimated-drag-list';
import { View, Text, StyleSheet } from 'react-native';

type Item = {
  id: string;
  title: string;
};

const data: Item[] = [
  { id: '1', title: 'Item 1' },
  { id: '2', title: 'Item 2' },
  { id: '3', title: 'Item 3' },
  // ... more items
];

function App() {
  const [items, setItems] = useState(data);

  const renderItem = ({ item, index }: RenderItemParams<Item>) => (
    <View style={styles.item}>
      <Text>{item.title}</Text>
    </View>
  );

  return (
    <DraggableList
      data={items}
      itemHeight={60}
      renderItem={renderItem}
      keyExtractor={(item) => item.id}
      onDragEnd={setItems}
      style={styles.list}
    />
  );
}

const styles = StyleSheet.create({
  list: {
    flex: 1,
  },
  item: {
    height: 60,
    backgroundColor: '#fff',
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
});
```

### Nesting Multiple Draggable Lists

You can render multiple `NestableDraggableFlatList` components within a single scrollable parent using `NestableScrollContainer`. This is useful when you have multiple categories or sections that each need their own reorderable list.

> **Note:** When using `NestableDraggableFlatList`, React Native warnings about nested VirtualizedLists are automatically suppressed.

```tsx
import {
  NestableScrollContainer,
  NestableDraggableFlatList,
} from 'react-native-reanimated-drag-list';

function App() {
  const [data1, setData1] = useState(initialData1);
  const [data2, setData2] = useState(initialData2);
  const [data3, setData3] = useState(initialData3);

  const renderItem = ({ item }) => (
    <View style={styles.item}>
      <Text>{item.label}</Text>
    </View>
  );

  const keyExtractor = (item) => item.id;

  return (
    <NestableScrollContainer style={styles.container}>
      <Text style={styles.header}>Shopping List</Text>
      <NestableDraggableFlatList
        data={data1}
        itemHeight={60}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        onDragEnd={setData1}
      />

      <Text style={styles.header}>Tasks</Text>
      <NestableDraggableFlatList
        data={data2}
        itemHeight={60}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        onDragEnd={setData2}
      />

      <Text style={styles.header}>Favorites</Text>
      <NestableDraggableFlatList
        data={data3}
        itemHeight={60}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        onDragEnd={setData3}
      />
    </NestableScrollContainer>
  );
}
```

### Dynamic Item Heights

`NestableDraggableFlatList` supports items with variable heights. Simply omit the `itemHeight` prop and let items measure themselves:

```tsx
import {
  NestableScrollContainer,
  NestableDraggableFlatList,
} from 'react-native-reanimated-drag-list';

function App() {
  const [items, setItems] = useState(data);

  const renderItem = ({ item }) => (
    <View style={styles.item}>
      <Text style={styles.title}>{item.title}</Text>
      {item.description && (
        <Text style={styles.description}>{item.description}</Text>
      )}
    </View>
  );

  return (
    <NestableScrollContainer style={styles.container}>
      <NestableDraggableFlatList
        data={items}
        // No itemHeight - heights are measured automatically
        estimatedItemHeight={80} // Optional: helps with initial layout
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        onDragEnd={setItems}
      />
    </NestableScrollContainer>
  );
}
```

### Drag Disabled Zones

Use `DragDisabledZone` to wrap interactive elements (buttons, inputs, etc.) that should not trigger drag activation:

```tsx
import {
  NestableScrollContainer,
  NestableDraggableFlatList,
  DragDisabledZone,
} from 'react-native-reanimated-drag-list';

function App() {
  const [items, setItems] = useState(data);

  const renderItem = ({ item }) => (
    <View style={[styles.item, { position: 'relative' }]}>
      <Text>{item.title}</Text>
      <DragDisabledZone>
        <TouchableOpacity
          style={styles.deleteButton}
          onPress={() => deleteItem(item.id)}
        >
          <Text>Delete</Text>
        </TouchableOpacity>
      </DragDisabledZone>
    </View>
  );

  return (
    <NestableScrollContainer>
      <NestableDraggableFlatList
        data={items}
        itemHeight={60}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        onDragEnd={setItems}
      />
    </NestableScrollContainer>
  );
}
```

## API Reference

### DraggableList Props

| Prop | Type | Required | Default | Description |
| ------ | ------ | ---------- | --------- | ------------- |
| `data` | `T[]` | ✅ | - | Array of items to render |
| `itemHeight` | `number` | ✅ | - | Height of each item (must be consistent) |
| `renderItem` | `(params: RenderItemParams<T>) => ReactNode` | ✅ | - | Function to render each item |
| `keyExtractor` | `(item: T) => string` | ✅ | - | Function to extract unique key from item |
| `onDragEnd` | `(data: T[]) => void` | ✅ | - | Callback with reordered data after drag ends |
| `style` | `ViewStyle` | ❌ | - | Style for the ScrollView container |
| `contentContainerStyle` | `ViewStyle` | ❌ | - | Style for the content container |
| `dragActivationDelay` | `number` | ❌ | `200` | Milliseconds to hold before drag activates |
| `itemSpringConfig` | `WithSpringConfig` | ❌ | `{ damping: 80, stiffness: 500 }` | Spring for swap shifts and scale return |
| `dropAnimation` | `'spring' \| 'timing'` | ❌ | `'timing'` | How the dragged item settles on release |
| `dropTimingConfig` | `WithTimingConfig` | ❌ | `{ duration: 180 }` | Timing config when `dropAnimation` is `'timing'` |
| `dropSpringConfig` | `WithSpringConfig` | ❌ | `{ damping: 40, stiffness: 350 }` | Spring config when `dropAnimation` is `'spring'` |
| `activeScale` | `number` | ❌ | `1.03` | Scale applied while an item is actively dragged |

### NestableScrollContainer Props

Extends all `ScrollView` props from `react-native-gesture-handler`. Supports `ref` forwarding to access the underlying ScrollView.

| Prop | Type | Required | Description |
| ---- | ---- | -------- | ----------- |
| `children` | `ReactNode` | ✅ | Content including `NestableDraggableFlatList` components |
| `measureKey` | `number` or `string` | ❌ | When this value changes, the container re-measures its position on screen. Useful when the container is inside an animated parent like a BottomSheet. |
| `onScroll` | `ScrollViewProps['onScroll']` | ❌ | Scroll event handler |
| `onScrollBeginDrag` | `ScrollViewProps['onScrollBeginDrag']` | ❌ | Called when user begins dragging the scroll view |
| `onScrollEndDrag` | `ScrollViewProps['onScrollEndDrag']` | ❌ | Called when user stops dragging the scroll view |
| `onMomentumScrollEnd` | `ScrollViewProps['onMomentumScrollEnd']` | ❌ | Called when momentum scroll animation ends |

#### Usage with BottomSheet

When using `NestableScrollContainer` inside a `BottomSheet`, pass the bottom sheet's index as `measureKey` to ensure auto-scroll works correctly when the sheet animates:

```tsx
import BottomSheet from '@gorhom/bottom-sheet';
import { NestableScrollContainer, NestableDraggableFlatList } from 'react-native-reanimated-drag-list';

function MyComponent() {
  const [bottomSheetIndex, setBottomSheetIndex] = useState(1);

  return (
    <BottomSheet
      index={1}
      snapPoints={['25%', '55%']}
      onChange={setBottomSheetIndex}
    >
      <NestableScrollContainer measureKey={bottomSheetIndex}>
        <NestableDraggableFlatList
          data={data}
          itemHeight={100}
          renderItem={renderItem}
          onDragEnd={handleDragEnd}
          keyExtractor={(item) => item.id}
        />
      </NestableScrollContainer>
    </BottomSheet>
  );
}
```

### NestableDraggableFlatList Props

| Prop | Type | Required | Default | Description |
| ---- | ---- | -------- | ------- | ----------- |
| `data` | `T[]` | ✅ | - | Array of items to render |
| `itemHeight` | `number` | ❌ | - | Fixed height for all items. If omitted, heights are measured dynamically. |
| `estimatedItemHeight` | `number` | ❌ | `60` | Estimated item height for initial layout (only used when `itemHeight` is not provided) |
| `renderItem` | `(params: RenderItemParams<T>) => ReactNode` | ✅ | - | Function to render each item |
| `keyExtractor` | `(item: T) => string` | ✅ | - | Function to extract unique key from item |
| `onDragEnd` | `(data: T[]) => void` | ✅ | - | Callback with reordered data after drag ends |
| `style` | `ViewStyle` | ❌ | - | Style for the list container |
| `contentContainerStyle` | `ViewStyle` | ❌ | - | Style for the content container |
| `dragActivationDelay` | `number` | ❌ | `200` | Milliseconds to hold before drag activates |
| `swapThreshold` | `number` | ❌ | `0.5` | Fraction of row height required to swap while dragging |
| `isItemLocked` | `(item: T, index: number) => boolean` | ❌ | - | Rows matching this predicate cannot be dragged or swapped with |
| `clampDragToBounds` | `boolean` | ❌ | `true` | Keep dragged item Y within list content height |
| `clipWhileDragging` | `boolean` | ❌ | `true` | Apply `overflow: 'hidden'` on the list while dragging |
| `getEstimatedItemHeight` | `(item: T, index: number) => number` | ❌ | - | Per-item height estimate before `onLayout` (use when row heights vary) |
| `ListHeaderComponent` | `ReactNode` | ❌ | - | Component rendered above list items |
| `ListFooterComponent` | `ReactNode` | ❌ | - | Component rendered below list items |
| `autoScrollThreshold` | `number` | ❌ | `100` | Distance from edge (in px) to trigger auto-scroll |
| `autoScrollMaxSpeed` | `number` | ❌ | `12` | Maximum auto-scroll speed (px per frame) |
| `autoScrollMinSpeed` | `number` | ❌ | `1` | Minimum auto-scroll speed (px per frame) |
| `autoScrollSmoothing` | `number` | ❌ | `0.15` | Smoothing factor for velocity transitions (0-1). Lower = smoother. |
| `itemSpringConfig` | `WithSpringConfig` | ❌ | `{ damping: 80, stiffness: 500 }` | Spring for swap shifts and scale return |
| `dropAnimation` | `'spring' \| 'timing'` | ❌ | `'timing'` | How the dragged item settles on release |
| `dropTimingConfig` | `WithTimingConfig` | ❌ | `{ duration: 180 }` | Timing config when `dropAnimation` is `'timing'` |
| `dropSpringConfig` | `WithSpringConfig` | ❌ | `{ damping: 40, stiffness: 350 }` | Spring config when `dropAnimation` is `'spring'` |
| `activeScale` | `number` | ❌ | `1.03` | Scale applied while an item is actively dragged |

### DragDisabledZone

A wrapper component that prevents drag activation on its children. Use this for buttons, inputs, or other interactive elements within draggable items.

The zone uses `position: 'absolute'` with `absoluteFillObject` so it does not shift siblings in normal layout flow. Put overlays (e.g. delete buttons with `position: 'absolute'`) inside the zone, and give the item root `position: 'relative'`.

Optional `style` prop for custom placement (e.g. `top` / `right` on a corner overlay instead of full-bleed).

```tsx
import { DragDisabledZone } from 'react-native-reanimated-drag-list';

<View style={{ position: 'relative' }}>
  <Image source={photo} />
  <DragDisabledZone>
    <Pressable style={{ position: 'absolute', top: 8, right: 8 }} onPress={onDelete}>
      <Icon name="trash" />
    </Pressable>
  </DragDisabledZone>
</View>
```

### RenderItemParams

```tsx
type RenderItemParams<T> = {
  item: T;           // The item data
  index: number;     // Current index in the list
  drag: () => void;  // Function to initiate drag (for custom handles)
  isActive: boolean; // Reserved for custom handles; currently always false (drag feedback uses internal scale)
};
```

Positions reset automatically when `data` key order or membership changes (e.g. after a server refetch). If you reorder optimistically in `onDragEnd`, keep local state in sync so keys match the new order.

## How It Works

1. **Long press** an item to activate drag mode (default 200ms)
2. **Drag** the item to reorder - other items animate out of the way
3. **Release** to drop the item in its new position
4. **Scroll** normally with quick swipes - dragging only activates on hold

### Auto-scroll Behavior

The list automatically scrolls when you drag an item near the top or bottom edges:

- **Direction-aware**: Only scrolls when you're actively moving toward the edge
- **Progressive speed**: Uses an exponential curve - gentle near the threshold, rapid at the edge
- **Smooth integration**: The dragged item follows the scroll seamlessly

## License

MIT
