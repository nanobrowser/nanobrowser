// The navigation policy: Nanobrowser's isUrlAllowed (src/background/browser/util.ts at ad47282),
// unchanged in its rules: schemes that are always blocked, then a deny list and an allow list of domains or exact URLs.
// Product sessions add a list of blocked sites, matched with siteOf.
import { siteOf } from './site';

export interface UrlPolicy {
  allow: string[];
  deny: string[];
  /**
   * Blocked sites, matched with `siteOf`: the exact host, so a row covers the same addresses as an Allow or Ask row.
   * The deny and allow lists keep their own rules for the test panel.
   */
  blocked?: string[];
}

export const EMPTY_POLICY: UrlPolicy = { allow: [], deny: [], blocked: [] };

/** A site as a user may type it ("Example.com", "https://www.example.com/x", "localhost:3000"), as `siteOf` keys it. */
export function siteKey(entry: string): string {
  const e = entry.trim();
  if (!e) return '';
  return siteOf(/^[a-z][a-z0-9+.-]*:\/\//i.test(e) ? e : `http://${e}`);
}

/** Whether an address loads a blocked site: its own site, or for a blob: URL the site that made it. */
export function isBlockedSite(url: string, blocked: readonly string[] | undefined): boolean {
  if (!blocked?.length) return false;
  const trimmed = url.trim();
  const site = siteOf(trimmed.toLowerCase().startsWith('blob:') ? trimmed.slice(5) : trimmed);
  return !!site && blocked.includes(site);
}

/** Blocked whatever the lists say. */
const DANGEROUS_PREFIXES = [
  'https://chromewebstore.google.com', // scripts are not allowed to be injected into the Chrome Web Store
  'chrome-extension://',
  'chrome://',
  'javascript:',
  'data:',
  'file:',
  'vbscript:',
  'ws:',
  'wss:',
];

export function isUrlAllowed(url: string, allowList: string[], denyList: string[]): boolean {
  const trimmedUrl = url.trim();
  if (trimmedUrl.length === 0) return false;
  const lowerCaseUrl = trimmedUrl.toLowerCase();
  if (DANGEROUS_PREFIXES.some(prefix => lowerCaseUrl.startsWith(prefix))) return false;
  if (allowList.length === 0 && denyList.length === 0) return true;
  // A blob: URL belongs to the origin that created it; judge it by that origin (its hostname would be empty).
  if (lowerCaseUrl.startsWith('blob:')) return isUrlAllowed(trimmedUrl.slice(5), allowList, denyList);
  if (trimmedUrl === 'about:blank') return true;
  try {
    const parsedUrl = new URL(trimmedUrl);
    const urlWithoutProtocol = lowerCaseUrl.replace(/^https?:\/\//, '');
    for (const deniedEntry of denyList) if (urlWithoutProtocol === deniedEntry) return false;
    for (const allowedEntry of allowList) if (urlWithoutProtocol === allowedEntry) return true;
    // A fully qualified name ("example.com.") is the same host as the name without its last dot.
    let domain = parsedUrl.hostname.toLowerCase().replace(/\.$/, '');
    const portIndex = domain.indexOf(':');
    if (portIndex > -1 && !domain.startsWith('[')) domain = domain.substring(0, portIndex);
    for (const deniedEntry of denyList) {
      if (domain === deniedEntry || domain.endsWith(`.${deniedEntry}`)) return false;
    }
    for (const allowedEntry of allowList) {
      if (domain === allowedEntry || domain.endsWith(`.${allowedEntry}`)) return true;
    }
    return allowList.length === 0;
  } catch {
    return false;
  }
}

/** Normalises list entries as the user types them: lower case, no scheme, no trailing slash. */
export function normalizePolicy(policy: UrlPolicy): UrlPolicy {
  const clean = (list: string[]) => [
    ...new Set(
      list
        .map(e =>
          e
            .trim()
            .toLowerCase()
            .replace(/^https?:\/\//, '')
            .replace(/\/$/, '')
            // A bare host written with its last dot ("example.com.") is the host without it, as in isUrlAllowed.
            .replace(/^([^/]+)\.$/, '$1'),
        )
        .filter(Boolean),
    ),
  ];
  return {
    allow: clean(policy.allow),
    deny: clean(policy.deny),
    blocked: [...new Set((policy.blocked ?? []).map(siteKey).filter(Boolean))],
  };
}

export function allows(policy: UrlPolicy, url: string): boolean {
  return !isBlockedSite(url, policy.blocked) && isUrlAllowed(url, policy.allow, policy.deny);
}

/** Layer 3 runs only when a list is configured; the always-blocked schemes are covered by layers 1, 2 and 4. */
export function hasLists(policy: UrlPolicy): boolean {
  return policy.allow.length > 0 || policy.deny.length > 0 || (policy.blocked?.length ?? 0) > 0;
}

/** The most restrictive combination: a URL passes only if every policy allows it. */
export function combinePolicies(policies: UrlPolicy[]): (url: string) => boolean {
  return url => policies.every(p => allows(p, url)) && isUrlAllowed(url, [], []);
}
