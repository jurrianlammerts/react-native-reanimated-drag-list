import React, { useEffect, useCallback } from 'react';
import type { ScrollViewProps, LayoutChangeEvent } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedRef,
  useAnimatedScrollHandler,
  measure,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { ScrollView } from 'react-native-gesture-handler';

import {
  NestableScrollContainerContext,
  suppressNestedListWarning,
  restoreNestedListWarning,
} from './NestableContext';

// Create animated version of RNGH ScrollView for better gesture handling
const AnimatedScrollView = Animated.createAnimatedComponent(ScrollView);

// ------------------------------------------------------------------
// TYPES
// ------------------------------------------------------------------
export type NestableScrollContainerProps = ScrollViewProps & {
  children: React.ReactNode;
};

// ------------------------------------------------------------------
// NESTABLE SCROLL CONTAINER
// ------------------------------------------------------------------
export function NestableScrollContainer({
  children,
  onScroll: onScrollProp,
  onLayout: onLayoutProp,
  onContentSizeChange: onContentSizeChangeProp,
  ...scrollViewProps
}: NestableScrollContainerProps) {
  const scrollY = useSharedValue(0);
  const containerHeight = useSharedValue(0);
  const containerTop = useSharedValue(0);
  const contentHeight = useSharedValue(0);
  const outerScrollEnabled = useSharedValue(true);
  const scrollViewRef = useAnimatedRef<any>();

  // Suppress nested list warnings when component mounts
  useEffect(() => {
    suppressNestedListWarning();
    return () => {
      restoreNestedListWarning();
    };
  }, []);

  const callOnScrollProp = useCallback(
    (event: any) => {
      onScrollProp?.(event);
    },
    [onScrollProp]
  );

  // Animated scroll handler
  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollY.value = event.contentOffset.y;
      if (onScrollProp) {
        // Call the user's onScroll handler on the JS thread
        scheduleOnRN(() => {
          callOnScrollProp({ nativeEvent: event });
        });
      }
    },
  });

  const handleLayout = useCallback(
    (e: LayoutChangeEvent) => {
      containerHeight.value = e.nativeEvent.layout.height;
      // Measure the container's position on screen using reanimated
      scheduleOnRN(() => {
        const measurement = measure(scrollViewRef);
        if (measurement) {
          containerTop.value = measurement.pageY;
        }
      });
      onLayoutProp?.(e);
    },
    [containerHeight, containerTop, scrollViewRef, onLayoutProp]
  );

  const handleContentSizeChange = (w: number, h: number) => {
    contentHeight.value = h;
    onContentSizeChangeProp?.(w, h);
  };

  return (
    <NestableScrollContainerContext.Provider
      value={{
        scrollY,
        containerHeight,
        containerTop,
        scrollViewRef,
        outerScrollEnabled,
        contentHeight,
      }}
    >
      <AnimatedScrollView
        ref={scrollViewRef}
        onScroll={scrollHandler}
        onLayout={handleLayout}
        onContentSizeChange={handleContentSizeChange}
        scrollEventThrottle={16}
        scrollEnabled={true}
        {...scrollViewProps}
      >
        {children}
      </AnimatedScrollView>
    </NestableScrollContainerContext.Provider>
  );
}
