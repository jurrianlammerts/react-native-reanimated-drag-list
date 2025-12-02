import { createContext, useContext } from 'react';
import type { SharedValue, AnimatedRef } from 'react-native-reanimated';

// ------------------------------------------------------------------
// CONTEXT TYPES
// ------------------------------------------------------------------
export type NestableScrollContainerContextType = {
  scrollY: SharedValue<number>;
  containerHeight: SharedValue<number>;
  /** Y position of container on screen - for relative auto-scroll calculation */
  containerTop: SharedValue<number>;
  scrollViewRef: AnimatedRef<any>;
  outerScrollEnabled: SharedValue<boolean>;
  /** Content height for auto-scroll calculations - updated by container */
  contentHeight: SharedValue<number>;
};

// ------------------------------------------------------------------
// CONTEXT
// ------------------------------------------------------------------
export const NestableScrollContainerContext =
  createContext<NestableScrollContainerContextType | null>(null);

// ------------------------------------------------------------------
// HOOK
// ------------------------------------------------------------------
export function useNestableScrollContainerContext() {
  const context = useContext(NestableScrollContainerContext);
  if (!context) {
    throw new Error(
      'useNestableScrollContainerContext must be used within a NestableScrollContainer'
    );
  }
  return context;
}

export function useOptionalNestableScrollContainerContext() {
  return useContext(NestableScrollContainerContext);
}

// ------------------------------------------------------------------
// SUPPRESS NESTED VIRTUALIZED LIST WARNING
// ------------------------------------------------------------------
// When using NestableDraggableFlatLists, React Native warnings about
// nested VirtualizedLists are expected and can be safely ignored.
// This utility suppresses those warnings.
const originalConsoleError = console.error;
let isWarningSuppressed = false;

export function suppressNestedListWarning() {
  if (isWarningSuppressed) return;
  isWarningSuppressed = true;

  console.error = (...args: any[]) => {
    const message = args[0];
    if (
      typeof message === 'string' &&
      (message.includes('VirtualizedLists should never be nested') ||
        message.includes('VirtualizedList: Encountered an error'))
    ) {
      return;
    }
    originalConsoleError.apply(console, args);
  };
}

export function restoreNestedListWarning() {
  if (!isWarningSuppressed) return;
  isWarningSuppressed = false;
  console.error = originalConsoleError;
}
