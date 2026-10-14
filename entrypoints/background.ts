import { defineBackground } from 'wxt/utils/define-background';
// Listener registration must stay synchronous at service worker start.
// WXT strips side-effect imports when it evaluates entrypoint options at build time, so main() stays empty.
import '@src/extension/index';
// The layer's test extension: checks, scenarios and the test panel's messages (developer-only).
import '@src/background/index';

export default defineBackground({ main() {} });
