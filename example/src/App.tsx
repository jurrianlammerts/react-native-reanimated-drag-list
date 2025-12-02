import * as React from 'react';
import { StyleSheet, View, Text, TouchableOpacity } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  DraggableList,
  NestableScrollContainer,
  NestableDraggableFlatList,
} from 'react-native-reanimated-drag-list';

// Generate color palettes for each list
const generateItems = (prefix: string, count: number, hueStart: number) =>
  Array.from({ length: count }, (_, i) => ({
    id: `${prefix}-${i}`,
    label: `${prefix} ${i + 1}`,
    backgroundColor: `hsl(${hueStart + ((i * 25) % 360)}, 65%, 55%)`,
  }));

type Item = {
  id: string;
  label: string;
  backgroundColor: string;
};

type TabType = 'basic' | 'nestable';

// ============================================================================
// TAB BUTTON COMPONENT
// ============================================================================
function TabButton({
  title,
  isActive,
  onPress,
}: {
  title: string;
  isActive: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.tabButton, isActive && styles.tabButtonActive]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Text
        style={[styles.tabButtonText, isActive && styles.tabButtonTextActive]}
      >
        {title}
      </Text>
    </TouchableOpacity>
  );
}

// ============================================================================
// SECTION HEADER COMPONENT
// ============================================================================
function SectionHeader({ text }: { text: string }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionHeaderText}>{text}</Text>
    </View>
  );
}

// ============================================================================
// BASIC DRAGGABLE LIST DEMO
// ============================================================================
function BasicListDemo() {
  const [data, setData] = React.useState(() => generateItems('Item', 15, 200));

  const renderItem = ({ item }: { item: Item }) => (
    <View style={[styles.item, { backgroundColor: item.backgroundColor }]}>
      <View style={styles.dragHandle}>
        <Text style={styles.dragHandleText}>⋮⋮</Text>
      </View>
      <Text style={styles.itemText}>{item.label}</Text>
    </View>
  );

  return (
    <View style={styles.demoContainer}>
      <Text style={styles.demoTitle}>DraggableList</Text>
      <Text style={styles.demoDescription}>
        A single scrollable list with draggable items
      </Text>
      <DraggableList
        data={data}
        itemHeight={70}
        keyExtractor={(item) => item.id}
        onDragEnd={setData}
        renderItem={renderItem}
        style={styles.list}
      />
    </View>
  );
}

// ============================================================================
// NESTABLE DRAGGABLE LIST DEMO
// ============================================================================
function NestableListDemo() {
  const [groceries, setGroceries] = React.useState(() =>
    generateItems('Grocery', 5, 120)
  );
  const [tasks, setTasks] = React.useState(() => generateItems('Task', 4, 0));
  const [movies, setMovies] = React.useState(() =>
    generateItems('Movie', 6, 270)
  );

  const renderItem = ({ item }: { item: Item }) => (
    <View style={[styles.item, { backgroundColor: item.backgroundColor }]}>
      <View style={styles.dragHandle}>
        <Text style={styles.dragHandleText}>⋮⋮</Text>
      </View>
      <Text style={styles.itemText}>{item.label}</Text>
    </View>
  );

  const keyExtractor = (item: Item) => item.id;

  return (
    <View style={styles.demoContainer}>
      <Text style={styles.demoTitle}>NestableDraggableFlatList</Text>
      <Text style={styles.demoDescription}>
        Multiple draggable lists in a single scroll container
      </Text>
      <NestableScrollContainer style={styles.nestableContainer}>
        <SectionHeader text="🛒 Groceries" />
        <NestableDraggableFlatList
          data={groceries}
          itemHeight={70}
          keyExtractor={keyExtractor}
          onDragEnd={setGroceries}
          renderItem={renderItem}
        />

        <SectionHeader text="✅ Tasks" />
        <NestableDraggableFlatList
          data={tasks}
          itemHeight={70}
          keyExtractor={keyExtractor}
          onDragEnd={setTasks}
          renderItem={renderItem}
        />

        <SectionHeader text="🎬 Watch List" />
        <NestableDraggableFlatList
          data={movies}
          itemHeight={70}
          keyExtractor={keyExtractor}
          onDragEnd={setMovies}
          renderItem={renderItem}
        />

        <View style={styles.footer}>
          <Text style={styles.footerText}>— End of lists —</Text>
        </View>
      </NestableScrollContainer>
    </View>
  );
}

// ============================================================================
// MAIN APP
// ============================================================================
export default function App() {
  const [activeTab, setActiveTab] = React.useState<TabType>('basic');

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.container}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title}>Reanimated Drag List</Text>
            <Text style={styles.subtitle}>
              Long press an item to start dragging
            </Text>
          </View>

          {/* Tab Navigation */}
          <View style={styles.tabBar}>
            <TabButton
              title="Basic List"
              isActive={activeTab === 'basic'}
              onPress={() => setActiveTab('basic')}
            />
            <TabButton
              title="Nested Lists"
              isActive={activeTab === 'nestable'}
              onPress={() => setActiveTab('nestable')}
            />
          </View>

          {/* Content */}
          <View style={styles.content}>
            {activeTab === 'basic' ? <BasicListDemo /> : <NestableListDemo />}
          </View>
        </View>
      </SafeAreaView>
    </GestureHandlerRootView>
  );
}

// ============================================================================
// STYLES
// ============================================================================
const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0f0f1a',
  },
  safeArea: {
    flex: 1,
  },
  container: {
    flex: 1,
  },
  header: {
    paddingTop: 16,
    paddingBottom: 12,
    paddingHorizontal: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#fff',
    textAlign: 'center',
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginTop: 4,
  },
  tabBar: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    gap: 12,
    marginBottom: 16,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: '#1a1a2e',
    alignItems: 'center',
  },
  tabButtonActive: {
    backgroundColor: '#6366f1',
  },
  tabButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#666',
  },
  tabButtonTextActive: {
    color: '#fff',
  },
  content: {
    flex: 1,
  },
  demoContainer: {
    flex: 1,
    paddingHorizontal: 20,
  },
  demoTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 4,
  },
  demoDescription: {
    fontSize: 13,
    color: '#888',
    marginBottom: 16,
  },
  list: {
    flex: 1,
    borderRadius: 16,
    overflow: 'hidden',
  },
  nestableContainer: {
    flex: 1,
  },
  sectionHeader: {
    paddingVertical: 14,
    paddingHorizontal: 4,
    marginTop: 8,
  },
  sectionHeaderText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: 0.3,
  },
  item: {
    height: 60,
    marginVertical: 5,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  dragHandle: {
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    opacity: 0.6,
  },
  dragHandleText: {
    fontSize: 16,
    color: '#fff',
    fontWeight: '900',
    letterSpacing: 2,
  },
  itemText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  footer: {
    paddingVertical: 32,
    alignItems: 'center',
  },
  footerText: {
    fontSize: 13,
    color: '#444',
    fontStyle: 'italic',
  },
});
