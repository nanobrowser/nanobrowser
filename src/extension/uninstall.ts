// No page opens after Nanobrowser is removed: an empty address clears any page an earlier build set.
export const UNINSTALL_FORM = '';

/** Clears the page at worker start. */
export function setUninstallPage(): void {
  void chrome.runtime.setUninstallURL('').catch(error => console.error('[uninstall] page not cleared', error));
}
