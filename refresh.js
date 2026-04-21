/* eslint-disable */
(function () {
  'use strict';
  // This is the custom ID for HMR (chrome-extension/vite.config.mts)
  const __HMR_ID = 'chrome-extension-hmr';

  const LOCAL_RELOAD_SOCKET_PORT = 8081;
  const LOCAL_RELOAD_SOCKET_URL = `ws://localhost:${LOCAL_RELOAD_SOCKET_PORT}`;

  const DO_UPDATE = 'do_update';
  const DONE_UPDATE = 'done_update';

  class MessageInterpreter {
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    constructor() {}

    static send(message) {
      return JSON.stringify(message);
    }

    static receive(serializedMessage) {
      return JSON.parse(serializedMessage);
    }
  }

  function initClient({ id, onUpdate }) {
    const ws = new WebSocket(LOCAL_RELOAD_SOCKET_URL);

    ws.onopen = () => {
      ws.addEventListener('message', event => {
        const message = MessageInterpreter.receive(String(event.data));

        if (message.type === DO_UPDATE && message.id === id) {
          onUpdate();
          ws.send(MessageInterpreter.send({ type: DONE_UPDATE }));
          return;
        }
      });
    };
  }

  function addRefresh() {
    let pendingReload = false;

    initClient({
      id: __HMR_ID,
      onUpdate: () => {
        // disable reload when tab is hidden
        if (document.hidden) {
          pendingReload = true;
          return;
        }
        reload();
      },
    });

    // reload
    function reload() {
      pendingReload = false;
      window.location.reload();
    }

    // reload when tab is visible
    function reloadWhenTabIsVisible() {
      !document.hidden && pendingReload && reload();
    }

    document.addEventListener('visibilitychange', reloadWhenTabIsVisible);
  }

  addRefresh();
})();
