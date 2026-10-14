// What's new in a release: at most three short highlights per version, shown once in the side panel after the
// extension updates to that version. A release that wants the card adds its entry here.
import type { MessageKey } from './i18n';

export const WHATS_NEW: Record<string, MessageKey[]> = {
  '0.3': ['whatsNew.v03.layer', 'whatsNew.v03.agent', 'whatsNew.v03.shortcuts'],
};

/** A version as the card names it: `0.3.0` is `0.3`. */
export function releaseOf(version: string): string {
  return version.split('.').slice(0, 2).join('.');
}
