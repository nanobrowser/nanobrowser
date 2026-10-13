import { PANEL_PORT } from './messages';
import type { PanelRequest, PanelResponse } from './messages';
import { call, onEmit } from './rpc';

chrome.runtime.onConnect.addListener(port => {
  if (port.name !== PANEL_PORT) return;
  const unsubscribe = onEmit(event => port.postMessage(event));
  port.onDisconnect.addListener(unsubscribe);
  port.onMessage.addListener(async (message: PanelRequest) => {
    let response: PanelResponse;
    try {
      response = { id: message.id, ok: true, result: await call(message.method, message.params) };
    } catch (error) {
      response = { id: message.id, ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    try {
      port.postMessage(response);
    } catch {
      // The panel closed while the call was running.
    }
  });
});
