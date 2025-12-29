import React, {
  useEffect,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from 'react';
import type { ScrollViewProps, LayoutChangeEvent } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedRef,
  useAnimatedScrollHandler,
  measure,
  runOnJS,
  runOnUI,
} from 'react-native-reanimated';
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
  /** Key that triggers re-measurement of container position when changed */
  measureKey?: number | string;
};

// ------------------------------------------------------------------
// NESTABLE SCROLL CONTAINER
// ------------------------------------------------------------------
export const NestableScrollContainer = forwardRef<
  any,
  NestableScrollContainerProps
>(function NestableScrollContainer(
  {
    children,
    onScroll: onScrollProp,
    onScrollBeginDrag: onScrollBeginDragProp,
    onScrollEndDrag: onScrollEndDragProp,
    onMomentumScrollEnd: onMomentumScrollEndProp,
    onLayout: onLayoutProp,
    onContentSizeChange: onContentSizeChangeProp,
    measureKey,
    ...scrollViewProps
  },
  ref
) {
  const scrollY = useSharedValue(0);
  const containerHeight = useSharedValue(0);
  const containerTop = useSharedValue(0);
  const contentHeight = useSharedValue(0);
  const outerScrollEnabled = useSharedValue(true);
  const scrollViewRef = useAnimatedRef<any>();

  // Track whether callbacks exist using shared values (accessible in worklets)
  const hasOnScrollProp = useSharedValue(!!onScrollProp);
  const hasOnScrollBeginDragProp = useSharedValue(!!onScrollBeginDragProp);
  const hasOnScrollEndDragProp = useSharedValue(!!onScrollEndDragProp);
  const hasOnMomentumScrollEndProp = useSharedValue(!!onMomentumScrollEndProp);

  // Update shared values when props change
  useEffect(() => {
    hasOnScrollProp.value = !!onScrollProp;
    hasOnScrollBeginDragProp.value = !!onScrollBeginDragProp;
    hasOnScrollEndDragProp.value = !!onScrollEndDragProp;
    hasOnMomentumScrollEndProp.value = !!onMomentumScrollEndProp;
  }, [
    onScrollProp,
    onScrollBeginDragProp,
    onScrollEndDragProp,
    onMomentumScrollEndProp,
    hasOnScrollProp,
    hasOnScrollBeginDragProp,
    hasOnScrollEndDragProp,
    hasOnMomentumScrollEndProp,
  ]);

  // Forward the internal ref to the external ref
  useImperativeHandle(ref, () => scrollViewRef.current, [scrollViewRef]);

  // Suppress nested list warnings when component mounts
  useEffect(() => {
    suppressNestedListWarning();
    return () => {
      restoreNestedListWarning();
    };
  }, []);

  // Re-measure container position when measureKey changes
  // This is useful when the container is inside a BottomSheet that animates
  useEffect(() => {
    if (measureKey === undefined) {
      return;
    }
    // Longer delay to allow BottomSheet animations to complete (~300ms typical)
    const timeoutId = setTimeout(() => {
      runOnUI(() => {
        const measurement = measure(scrollViewRef);
        if (measurement) {
          containerTop.value = measurement.pageY;
          containerHeight.value = measurement.height;
        }
      })();
    }, 350);
    return () => clearTimeout(timeoutId);
  }, [measureKey, scrollViewRef, containerTop, containerHeight]);

  const callOnScrollProp = useCallback(
    (event: any) => {
      onScrollProp?.(event);
    },
    [onScrollProp]
  );

  const callOnScrollBeginDragProp = useCallback(
    (event: any) => {
      onScrollBeginDragProp?.(event);
    },
    [onScrollBeginDragProp]
  );

  const callOnScrollEndDragProp = useCallback(
    (event: any) => {
      onScrollEndDragProp?.(event);
    },
    [onScrollEndDragProp]
  );

  const callOnMomentumScrollEndProp = useCallback(
    (event: any) => {
      onMomentumScrollEndProp?.(event);
    },
    [onMomentumScrollEndProp]
  );

  // Animated scroll handler
  // Note: We use shared values (hasOn*Prop) to check if callbacks exist
  // because worklets run on the UI thread and can't access JS values directly
  // We use runOnJS to call JS callbacks from the UI thread
  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollY.value = event.contentOffset.y;
      if (hasOnScrollProp.value) {
        runOnJS(callOnScrollProp)({ nativeEvent: event });
      }
    },
    onBeginDrag: (event) => {
      if (hasOnScrollBeginDragProp.value) {
        runOnJS(callOnScrollBeginDragProp)({ nativeEvent: event });
      }
    },
    onEndDrag: (event) => {
      if (hasOnScrollEndDragProp.value) {
        runOnJS(callOnScrollEndDragProp)({ nativeEvent: event });
      }
    },
    onMomentumEnd: (event) => {
      if (hasOnMomentumScrollEndProp.value) {
        runOnJS(callOnMomentumScrollEndProp)({ nativeEvent: event });
      }
    },
  });

  const handleLayout = useCallback(
    (e: LayoutChangeEvent) => {
      containerHeight.value = e.nativeEvent.layout.height;
      // Measure the container's position on screen using reanimated
      runOnUI(() => {
        const measurement = measure(scrollViewRef);
        if (measurement) {
          containerTop.value = measurement.pageY;
        }
      })();
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
});
