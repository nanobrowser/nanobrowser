// Analytics, removed for this build: nothing is counted, stored or sent. The functions keep their signatures so the
// run manager and the panel port stay unchanged; each does nothing, except the parts of the old start-up step and
// Delete everything that are not analytics.
import type { ModelRef, PermissionMode, RunModel, RunRecord } from '@src/store';
import { ANALYTICS_KEYS } from '@src/store';
import type { ReasoningEffort } from '@src/llm/catalogue';
import type { PanelCommand, PanelEventBody } from '@src/ui/protocol';
import type { LoopEnd } from '@src/agent/loop';
import type { Feature } from './analytics-payload';
import { upgradeFromOldVersion } from './upgrade';

let ready: Promise<boolean> | null = null;

export function restartAnalytics(): void {
  ready = null;
}

/** The move from the old Nanobrowser still runs; any analytics state an older build left is deleted. */
export function analyticsReady(): Promise<boolean> {
  ready ??= upgradeFromOldVersion()
    .then(() => chrome.storage.local.remove(ANALYTICS_KEYS))
    .then(
      () => true,
      error => {
        console.error('[analytics] start-up failed', error);
        ready = null;
        return false;
      },
    );
  return ready;
}

export async function recordInstall(): Promise<void> {}

/** Delete everything: `remove` deletes all data, settings included. */
export async function deleteKeepingChoices(remove: () => Promise<void>): Promise<void> {
  await remove();
}

export async function count(_key: string, _n = 1, _mode: 'add' | 'set' = 'add'): Promise<void> {}

export function countFeature(_feature: Feature): void {}

export function observe(_body: PanelEventBody): void {}

export function observeCommand(_command: PanelCommand): void {}

export async function runModel(_ref: ModelRef): Promise<RunModel | undefined> {
  return undefined;
}

export async function runStarted(
  _model: RunModel,
  _effort: ReasoningEffort,
  _mode: PermissionMode,
  _vision: boolean,
  _concurrent: boolean,
): Promise<void> {}

export function runEnded(_record: RunRecord, _end: Pick<LoopEnd, 'cause' | 'providerError'>): void {}

export function noteActivity(_kind: 'panel' | 'run'): void {}

export async function sendDue(_kind: 'panel' | 'run'): Promise<void> {}

export function listenForSwitches(): void {}
