export interface BrowserState {
  activeTab?: {
    id?: number;
    url?: string;
    title?: string;
    domState?: any;
  };
  tabs?: Array<{
    id?: number;
    url?: string;
    title?: string;
    active?: boolean;
  }>;
}

export class BrowserResources {
  private browserState: BrowserState = {};

  public updateState(state: BrowserState) {
    this.browserState = state;
    console.error('Browser state updated:', JSON.stringify(state, null, 2).substring(0, 200) + '...');
  }

  public listResources() {
    return [
      {
        uri: 'browser://current/state',
        name: 'Current Browser State',
        mimeType: 'application/json',
        description: 'Complete state of the current active page and all tabs',
      },
      {
        uri: 'browser://current/dom',
        name: 'Current Page DOM',
        mimeType: 'application/json',
        description: 'DOM structure of the current page',
      },
    ];
  }

  public async readResource(uri: string) {
    if (!this.browserState) {
      throw new Error('Browser state not available');
    }

    switch (uri) {
      case 'browser://current/state':
        return {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(this.browserState, null, 2),
            },
          ],
        };

      case 'browser://current/dom':
        if (!this.browserState.activeTab?.domState) {
          throw new Error('DOM state not available');
        }

        return {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(this.browserState.activeTab.domState, null, 2),
            },
          ],
        };

      default:
        throw new Error(`Resource not found: ${uri}`);
    }
  }
}
