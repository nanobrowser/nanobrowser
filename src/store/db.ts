// The IndexedDB schema, through `idb`. Versions migrate in place: each step of `upgrade` takes the database from one
// version to the next.
import { openDB } from 'idb';
import type { DBSchema, IDBPDatabase } from 'idb';
import type { Conversation, Entry, RunRecord, StoredBlob, StoredShortcut } from './types';

export interface NanoDB extends DBSchema {
  conversations: { key: string; value: Conversation; indexes: { updatedAt: string } };
  entries: { key: string; value: Entry; indexes: { conversationId: string } };
  runs: { key: string; value: RunRecord; indexes: { status: string } };
  blobs: { key: string; value: StoredBlob; indexes: { conversationId: string } };
  shortcuts: { key: string; value: StoredShortcut };
}

export const DB_NAME = 'nanobrowser';
export const DB_VERSION = 1;

let opening: Promise<IDBPDatabase<NanoDB>> | null = null;

export function db(): Promise<IDBPDatabase<NanoDB>> {
  opening ??= openDB<NanoDB>(DB_NAME, DB_VERSION, {
    upgrade(database, oldVersion) {
      if (oldVersion < 1) {
        database.createObjectStore('conversations', { keyPath: 'id' }).createIndex('updatedAt', 'updatedAt');
        database.createObjectStore('entries', { keyPath: 'id' }).createIndex('conversationId', 'conversationId');
        database.createObjectStore('runs', { keyPath: 'conversationId' }).createIndex('status', 'status');
        database.createObjectStore('blobs', { keyPath: 'id' }).createIndex('conversationId', 'conversationId');
        database.createObjectStore('shortcuts', { keyPath: 'id' });
      }
    },
    blocking() {
      // A newer version is waiting: let it open.
      void opening?.then(d => d.close());
      opening = null;
    },
  });
  return opening;
}

/** For tests: forget the open connection. */
export async function closeDb(): Promise<void> {
  const current = opening;
  opening = null;
  if (current) (await current).close();
}
