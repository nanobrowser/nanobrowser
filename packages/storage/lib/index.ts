export type { BaseStorage } from './base/types';
export * from './settings';
export * from './chat';
export * from './profile';
export * from './prompt/favorites';

// Re-export the favorites instance for direct use
export { default as favoritesStorage } from './prompt/favorites';

export { useProfileStore } from './stores/profileStore';
export type { ProfileData } from './stores/profileStore';
