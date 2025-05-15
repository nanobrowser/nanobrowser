import { Resource } from './types.js';
import { browserState } from './shared-state.js';

export const currentStateResource: Resource = {
  uri: 'browser://current/state',
  name: 'Current Browser State',
  mimeType: 'application/json',
  description: 'Complete state of the current active page and all tabs',

  async read() {
    const state = browserState.getState();
    if (!state) {
      throw new Error('Browser state not available');
    }

    return {
      contents: [
        {
          uri: 'browser://current/state',
          mimeType: 'application/json',
          text: JSON.stringify(state, null, 2),
        },
      ],
    };
  },
};
