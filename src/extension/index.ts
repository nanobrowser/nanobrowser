// The product's wiring in the service worker. Listener registration stays synchronous at worker start.
import './panel';
import { addFirstShortcuts } from './first-run';
import { listenForPanels } from './panel-port';
import { RunManager } from './run-manager';
import { listenForSelections } from './selection';
import { upgradeFromOldVersion } from './upgrade';
import { analyticsReady, listenForSwitches, recordInstall } from './analytics';
import { setUninstallPage } from './uninstall';
import { openWhatsNew } from '@src/store/whats-new';
import { WHATS_NEW, releaseOf } from '@src/ui/whats-new';
import { DATA_REQUEST } from '@src/ui/protocol';

export const runManager = new RunManager();
listenForPanels(runManager);
listenForSelections(runManager);
// The watchdog alarm only wakes the worker; starting it is what restores an unfinished run.
// The welcome page and the first shortcut on install. Unattended check builds are installed on every run, so they
// skip both.
chrome.runtime.onInstalled.addListener(details => {
  if (details.reason === 'update') {
    console.info(`[install] updated from ${details.previousVersion}`);
    // A release with highlights shows its card once in the side panel.
    const release = releaseOf(chrome.runtime.getManifest().version);
    if (WHATS_NEW[release] && releaseOf(details.previousVersion ?? '') !== release) {
      void openWhatsNew(release).catch(error => console.error('[install] what is new failed', error));
    }
  }
  // Analytics records a real install's week; autorun builds too, so their check can see it.
  if (details.reason === 'install')
    void recordInstall().catch(error => console.error('[analytics] install failed', error));
  if (details.reason !== 'install' || import.meta.env.WXT_AUTORUN_URL) return;
  void addFirstShortcuts().catch(error => console.error('[install] first shortcut failed', error));
  void chrome.tabs.create({ url: chrome.runtime.getURL('/welcome.html') });
});
// Settings → Data → Delete everything goes through the RunManager, which stops running tasks first.
chrome.runtime.onMessage.addListener((message: unknown, sender, reply) => {
  const m = message as { type?: string; op?: 'delete-all' };
  if (m?.type !== DATA_REQUEST || sender.id !== chrome.runtime.id) return;
  const done = m.op === 'delete-all' ? runManager.deleteAll() : Promise.reject(new Error('unknown request'));
  done.then(
    () => reply({ ok: true }),
    error => reply({ ok: false, error: String(error) }),
  );
  return true;
});
chrome.alarms?.onAlarm.addListener(() => undefined);
void runManager.restore().catch(error => console.error('[runs] restore failed', error));
// An update from the old Nanobrowser: its data is moved on the first start that finds it, whenever that comes.
void upgradeFromOldVersion().catch(error => console.error('[upgrade] move failed', error));
// Analytics waits for that move, then applies the old version's choice once; nothing is sent before.
void analyticsReady();
listenForSwitches();
setUninstallPage();
