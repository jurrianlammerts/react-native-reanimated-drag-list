# react-native-reanimated-drag-list

A high-performance draggable list component for React Native, built with Reanimated 4 and Gesture Handler. Runs entirely on the UI thread for buttery smooth 60fps animations.

## Features

- 🚀 **UI Thread Performance** - All animations run on the UI thread via Reanimated
- 📜 **Auto-scroll** - Automatically scrolls when dragging near edges
- ⏱️ **Long Press Activation** - Hold to drag, tap to scroll - configurable delay
- 🎯 **Smooth Animations** - Spring animations for natural feeling interactions
- 📱 **Fabric Ready** - Built for the new React Native architecture

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

## Props

| Prop | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `data` | `T[]` | ✅ | - | Array of items to render |
| `itemHeight` | `number` | ✅ | - | Height of each item (must be consistent) |
| `renderItem` | `(params: RenderItemParams<T>) => ReactNode` | ✅ | - | Function to render each item |
| `keyExtractor` | `(item: T) => string` | ✅ | - | Function to extract unique key from item |
| `onDragEnd` | `(data: T[]) => void` | ✅ | - | Callback with reordered data after drag ends |
| `style` | `ViewStyle` | ❌ | - | Style for the ScrollView container |
| `contentContainerStyle` | `ViewStyle` | ❌ | - | Style for the content container |
| `dragActivationDelay` | `number` | ❌ | `200` | Milliseconds to hold before drag activates |

## RenderItemParams

```tsx
type RenderItemParams<T> = {
  item: T;           // The item data
  index: number;     // Current index in the list
  drag: () => void;  // Function to initiate drag (for custom handles)
  isActive: boolean; // Whether this item is being dragged
};
```

## How It Works

1. **Long press** an item to activate drag mode (default 200ms)
2. **Drag** the item to reorder - other items animate out of the way
3. **Release** to drop the item in its new position
4. **Scroll** normally with quick swipes - dragging only activates on hold

The list automatically scrolls when you drag an item near the top or bottom edges.

## License

MIT
