// What a site is: the host of an address as the address bar shows it, lower case, with a trailing dot and a leading
// `www.` removed, and the port when it is not the default. The scheme is not part of it. One function makes the key, so
// Allow, Ask and Block rules and the boundary's source label all agree.
export function siteOf(address: string): string {
  try {
    const url = new URL(address);
    if (!url.hostname) return '';
    let host = url.hostname.toLowerCase().replace(/\.$/, '');
    if (host.startsWith('www.')) host = host.slice(4);
    // URL drops the scheme's default port already.
    return url.port ? `${host}:${url.port}` : host;
  } catch {
    return '';
  }
}
