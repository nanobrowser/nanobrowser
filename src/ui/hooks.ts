import { useSyncExternalStore } from 'react';
import type { Storage } from '@src/store/storage';

/** The live value of a chrome.storage value, or the fallback until it is read. */
export function useStorage<D>(storage: Storage<D>, fallback: D): D {
  return useSyncExternalStore(storage.subscribe, () => storage.getSnapshot() ?? fallback);
}
