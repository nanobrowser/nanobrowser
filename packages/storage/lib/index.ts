export type { BaseStorage } from './base/types';
export * from './settings';
export * from './chat';
export * from './profile';
export * from './prompt/favorites';
export * from './accessibility';

// Re-export the favorites instance for direct use
export { default as favoritesStorage } from './prompt/favorites';
// Re-export the accessibility store instance for direct use
export { accessibilityStore } from './accessibility';
