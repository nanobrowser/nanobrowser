// The worker's end of the panel protocol. Only the extension's own panel page may connect: there is no external
// listener, and a port from anything else is closed at once.
import { PANEL_PORT_NAME } from '@src/ui/protocol';
import type { PanelCommand, PanelEvent } from '@src/ui/protocol';
import type { PanelConnection, RunManager } from './run-manager';

export function listenForPanels(manager: RunManager): void {
  const panelUrl = chrome.runtime.getURL('/sidepanel.html');
  chrome.runtime.onConnect.addListener(port => {
    if (port.name !== PANEL_PORT_NAME) return;
    if (port.sender?.id !== chrome.runtime.id || !port.sender?.url?.startsWith(panelUrl)) {
      port.disconnect();
      return;
    }
    let open = true;
    const connection: PanelConnection = {
      tabId: null,
      conversationId: null,
      sink: (event: PanelEvent) => {
        if (open) port.postMessage(event);
      },
    };
    manager.connections.add(connection);
    port.onDisconnect.addListener(() => {
      open = false;
      manager.connections.delete(connection);
      connection.unsubscribe?.();
    });
    const run = (command: PanelCommand) =>
      manager.handle(connection, command).catch(error => {
        console.error('[panel] command failed', command.type, error);
        connection.sink({
          type: 'error',
          message: error instanceof Error ? error.message : String(error),
          seq: 0,
          conversationId: connection.conversationId,
        });
      });
    // Commands are handled in order, so a send that follows a subscribe sees its result. An answer to a card is not
    // queued: a command can be waiting for that very card (sharing a tab another conversation holds), and the card
    // it answers is already open.
    let queue = Promise.resolve();
    port.onMessage.addListener((command: PanelCommand) => {
      if (command.type === 'answer') {
        void run(command);
        return;
      }
      queue = queue.then(() => run(command));
    });
  });
}
