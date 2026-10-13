// Stands in for `@puppeteer/browsers` in the extension build.
// Since puppeteer-core 25, connect() dynamically imports it for the `channel` option, which is never used here.
// Copied from Nanobrowser at ad47282.
const unsupported = (): never => {
  throw new Error('@puppeteer/browsers is not available in the extension');
};

export const Browser = {};
export const ChromeReleaseChannel = {};
export const detectBrowserPlatform = unsupported;
export const resolveDefaultUserDataDir = unsupported;
