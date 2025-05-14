export interface ActionResult {
  success: boolean;
  message?: string;
  data?: any;
}

export interface ActionCallback {
  (action: string, params: any): Promise<ActionResult>;
}

export class BrowserTools {
  private browserActionCallback: ActionCallback | null = null;

  constructor() {}

  public setBrowserActionCallback(callback: ActionCallback) {
    this.browserActionCallback = callback;
  }

  public listTools() {
    return [
      {
        name: 'navigate_to',
        description: 'Navigate to a specified URL',
        inputSchema: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'The URL to navigate to',
            },
          },
          required: ['url'],
        },
      },
      {
        name: 'click_element',
        description: 'Click on a specified element',
        inputSchema: {
          type: 'object',
          properties: {
            selector: {
              type: 'string',
              description: 'CSS selector of the element to click',
            },
          },
          required: ['selector'],
        },
      },
      {
        name: 'add',
        description: 'Add two numbers together for testing purposes',
        inputSchema: {
          type: 'object',
          properties: {
            a: {
              type: 'number',
              description: 'First number to add',
            },
            b: {
              type: 'number',
              description: 'Second number to add',
            },
          },
          required: ['a', 'b'],
        },
      },
    ];
  }

  public async callTool(name: string, args: any) {
    if (!this.browserActionCallback) {
      throw new Error('Browser action callback not set');
    }

    switch (name) {
      case 'navigate_to':
        if (!args.url) {
          throw new Error('URL is required for navigation');
        }
        return this.browserActionCallback('navigate', { url: args.url });

      case 'click_element':
        if (!args.selector) {
          throw new Error('Element selector is required for clicking');
        }
        return this.browserActionCallback('click', { selector: args.selector });

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }
}
