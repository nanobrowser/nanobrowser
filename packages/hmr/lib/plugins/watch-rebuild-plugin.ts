import fs from 'node:fs';
import path from 'node:path';
import type { PluginOption } from 'vite';
import { WebSocket } from 'ws';
import MessageInterpreter from '../interpreter';
import { BUILD_COMPLETE, LOCAL_RELOAD_SOCKET_URL } from '../constant';
import type { PluginConfig } from '../types';

const injectionsPath = path.resolve(__dirname, '..', '..', '..', 'build', 'injections');

const refreshCode = fs.readFileSync(path.resolve(injectionsPath, 'refresh.js'), 'utf-8');
const reloadCode = fs.readFileSync(path.resolve(injectionsPath, 'reload.js'), 'utf-8');

export function watchRebuildPlugin(config: PluginConfig): PluginOption {
  const { refresh, reload, id: _id, onStart } = config;
  const hmrCode = (refresh ? refreshCode : '') + (reload ? reloadCode : '');

  let ws: WebSocket | null = null;

  const id = _id ?? Math.random().toString(36);
  let reconnectTries = 0;

  function initializeWebSocket() {
    ws = new WebSocket(LOCAL_RELOAD_SOCKET_URL);

    ws.onopen = () => {
      console.log(`[HMR] Connected to dev-server at ${LOCAL_RELOAD_SOCKET_URL}`);
    };

    ws.onerror = () => {
      console.error(`[HMR] Failed to connect server at ${LOCAL_RELOAD_SOCKET_URL}`);
      console.warn('Retrying in 3 seconds...');
      ws = null;

      if (reconnectTries <= 2) {
        setTimeout(() => {
          reconnectTries++;
          initializeWebSocket();
        }, 3_000);
      } else {
        console.error(`[HMR] Cannot establish connection to server at ${LOCAL_RELOAD_SOCKET_URL}`);
      }
    };
  }

  const banner = `(function(){let __HMR_ID="${id}";\n${hmrCode}\n})();`;

  return {
    name: 'watch-rebuild',

    /**
     * Use Rollup's banner option to inject HMR code before sourcemap generation.
     * This ensures that sourcemaps remain accurate by accounting for the injected lines.
     *
     * Previously, code was injected in generateBundle() after sourcemap creation,
     * causing line number mismatches in dev tools.
     */
    outputOptions(outputOptions) {
      const existingBanner = outputOptions.banner;

      if (typeof existingBanner === 'string') {
        outputOptions.banner = existingBanner + '\n' + banner;
      } else if (typeof existingBanner === 'function') {
        outputOptions.banner = (...args) => {
          const result = existingBanner(...args);
          return (result || '') + '\n' + banner;
        };
      } else {
        outputOptions.banner = banner;
      }

      return outputOptions;
    },

    writeBundle() {
      onStart?.();
      if (!ws) {
        initializeWebSocket();
        return;
      }
      /**
       * When the build is complete, send a message to the reload server.
       * The reload server will send a message to the client to reload or refresh the extension.
       */
      ws.send(MessageInterpreter.send({ type: BUILD_COMPLETE, id }));
    },
  };
}
