import { Resource } from './types.js';
import { browserState } from './shared-state.js';

export const currentDomResource: Resource = {
  uri: 'browser://current/dom',
  name: 'Current Page DOM',
  mimeType: 'application/json',
  description: 'DOM structure of the current page',

  async read() {
    const state = browserState.getState();
    if (!state) {
      throw new Error('Browser state not available');
    }

    if (!state.activeTab?.domState) {
      throw new Error('DOM state not available');
    }

    return {
      contents: [
        {
          uri: 'browser://current/dom',
          mimeType: 'application/json',
          text: JSON.stringify(state.activeTab.domState, null, 2),
        },
      ],
    };
  },
};
