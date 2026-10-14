// The extension's Chrome permissions, for the build config, the worker, the pages and the checks.
//
// Four permissions are optional in the product: each adds an install warning the old Nanobrowser did not have, and
// Chrome turns an extension off after an update that adds a warning until the user accepts it. Each feature that uses
// one works with less until the user allows it with a click. The autorun build keeps the four required, so the checks
// that save files or group tabs run without a click.

/** Tab group titles and colours, notifications, saving files, and Open on a saved file. */
export const OPTIONAL_PERMISSIONS = [
  'tabGroups',
  'notifications',
  'downloads',
  'downloads.open',
] as const satisfies readonly chrome.runtime.ManifestOptionalPermission[];

export type OptionalPermission = (typeof OPTIONAL_PERMISSIONS)[number];

/** Always required. None of them adds a warning the old version did not have. */
export const REQUIRED_PERMISSIONS = [
  'debugger',
  'tabs',
  'sidePanel',
  'storage',
  'webNavigation',
  'unlimitedStorage',
  'alarms',
  'offscreen',
  'contextMenus',
  'scripting',
] as const satisfies readonly chrome.runtime.ManifestPermission[];

export interface PermissionLists {
  permissions: chrome.runtime.ManifestPermission[];
  optional_permissions: chrome.runtime.ManifestOptionalPermission[];
}

/** The manifest's two lists: the product asks for the four when the user allows them, the autorun build at install. */
export function permissionLists(build: 'product' | 'autorun'): PermissionLists {
  return build === 'product'
    ? { permissions: [...REQUIRED_PERMISSIONS], optional_permissions: [...OPTIONAL_PERMISSIONS] }
    : { permissions: [...REQUIRED_PERMISSIONS, ...OPTIONAL_PERMISSIONS], optional_permissions: [] };
}
