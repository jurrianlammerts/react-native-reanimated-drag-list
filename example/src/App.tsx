import * as React from 'react';
import { StyleSheet, View, Text } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { DraggableList } from 'react-native-reanimated-drag-list';

const DATA = Array.from({ length: 20 }, (_, i) => ({
  id: `item-${i}`,
  label: `Item ${i}`,
}));

export default function App() {
  const [data, setData] = React.useState(DATA);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <View style={styles.container}>
        <DraggableList
          data={data}
          itemHeight={60}
          keyExtractor={(item) => item.id}
          onDragEnd={setData}
          renderItem={({ item }) => (
            <View style={styles.item}>
              <Text>{item.label}</Text>
            </View>
          )}
        />
      </View>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 50, backgroundColor: '#eee' },
  item: {
    height: 50,
    margin: 5,
    backgroundColor: 'white',
    justifyContent: 'center',
    paddingLeft: 20,
  },
});
