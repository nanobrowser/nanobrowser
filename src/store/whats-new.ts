// Whether the side panel shows the What's new card: written when the extension updates to a version that has an
// entry, and closed by the user. A new install has none, so the welcome page is the only greeting.
import { createStorage } from './storage';

export interface WhatsNewState {
  /** The release the card is about, such as `0.3`. */
  version: string;
  dismissed: boolean;
}

export const WHATS_NEW_KEY = 'nb.whatsNew';

export const whatsNewStorage = createStorage<WhatsNewState | null>(WHATS_NEW_KEY, null, { liveUpdate: true });

/** Opens the card for `version`, unless the user already saw this release's card. */
export async function openWhatsNew(version: string): Promise<void> {
  const current = (await chrome.storage.local.get(WHATS_NEW_KEY))[WHATS_NEW_KEY] as WhatsNewState | undefined;
  if (current?.version === version) return;
  await chrome.storage.local.set({ [WHATS_NEW_KEY]: { version, dismissed: false } satisfies WhatsNewState });
}
