// The page Chrome opens after Nanobrowser is removed: a short Google Form, in English for every language, asking why.
// Its address carries nothing about the user.
export const UNINSTALL_FORM =
  'https://docs.google.com/forms/d/e/1FAIpQLSfWb8EUQ3Z0ey7nJ0ekbwuNPtBq_88M_2eZ4IxUQ8JiyyQhXA/viewform';

/** Sets the page at worker start. */
export function setUninstallPage(): void {
  void chrome.runtime.setUninstallURL(UNINSTALL_FORM).catch(error => console.error('[uninstall] page not set', error));
}
