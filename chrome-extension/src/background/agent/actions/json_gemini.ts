// TODO: don't know why zod can not generate the same schema, need to fix it
export const geminiNavigatorOutputSchema = {
  type: 'object',
  properties: {
    current_state: {
      type: 'object',
      description: 'Current state of the agent',
      properties: {
        evaluation_previous_goal: {
          type: 'string',
        },
        memory: {
          type: 'string',
        },
        next_goal: {
          type: 'string',
        },
      },
      required: ['evaluation_previous_goal', 'memory', 'next_goal'],
    },
    action: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          done: {
            type: 'object',
            description: 'Complete task',
            nullable: true,
            properties: {
              text: {
                type: 'string',
              },
              success: {
                type: 'boolean',
              },
            },
            required: ['text', 'success'],
          },
          search_google: {
            type: 'object',
            description:
              'Search the query in Google in the current tab, the query should be a search query like humans search in Google, concrete and not vague or super long. More the single most important items. ',
            nullable: true,
            properties: {
              intent: {
                type: 'string',
                description: 'purpose of this action',
              },
              query: {
                type: 'string',
              },
            },
            required: ['intent', 'query'],
          },
          go_to_url: {
            type: 'object',
            description: 'Navigate to URL in the current tab',
            nullable: true,
            properties: {
              intent: {
                type: 'string',
                description: 'purpose of this action',
              },
              url: {
                type: 'string',
              },
            },
            required: ['intent', 'url'],
          },
          go_back: {
            type: 'object',
            description: 'Go back to previous page',
            nullable: true,
            properties: {
              intent: {
                type: 'string',
                description: 'purpose of this action',
              },
            },
            required: ['intent'],
          },
          wait: {
            type: 'object',
            description: 'Wait for x seconds default 3, do not use this action unless user asks for it',
            nullable: true,
            properties: {
              intent: {
                type: 'string',
                description: 'purpose of this action',
              },
              seconds: {
                type: 'integer',
              },
            },
            required: ['intent', 'seconds'],
          },
          click_element: {
            type: 'object',
            description: 'Click element by index',
            nullable: true,
            properties: {
              intent: {
                type: 'string',
                description: 'purpose of this action',
              },
              index: {
                type: 'integer',
              },
              xpath: {
                type: 'string',
                nullable: true,
              },
            },
            required: ['intent', 'index'],
          },
          input_text: {
            type: 'object',
            description: 'Input text into an interactive input element',
            nullable: true,
            properties: {
              intent: {
                type: 'string',
                description: 'purpose of this action',
              },
              index: {
                type: 'integer',
              },
              text: {
                type: 'string',
              },
              xpath: {
                type: 'string',
                nullable: true,
              },
            },
            required: ['intent', 'index', 'text'],
          },
          switch_tab: {
            type: 'object',
            description: 'Switch tab',
            nullable: true,
            properties: {
              intent: {
                type: 'string',
                description: 'purpose of this action',
              },
              tab_id: {
                type: 'integer',
              },
            },
            required: ['intent', 'tab_id'],
          },
          open_tab: {
            type: 'object',
            description: 'Open url in new tab',
            nullable: true,
            properties: {
              intent: {
                type: 'string',
                description: 'purpose of this action',
              },
              url: {
                type: 'string',
              },
            },
            required: ['intent', 'url'],
          },
          close_tab: {
            type: 'object',
            description: 'Close tab by tab_id',
            nullable: true,
            properties: {
              intent: {
                type: 'string',
                description: 'purpose of this action',
              },
              tab_id: {
                type: 'integer',
              },
            },
            required: ['intent', 'tab_id'],
          },
          cache_content: {
            type: 'object',
            description: 'Cache what you have found so far from the current page for future use',
            nullable: true,
            properties: {
              intent: {
                type: 'string',
                description: 'purpose of this action',
              },
              content: {
                type: 'string',
              },
            },
            required: ['intent', 'content'],
          },
          scroll_down: {
            type: 'object',
            description: 'Scroll down the page by pixel amount - if no amount is specified, scroll down one page',
            nullable: true,
            properties: {
              intent: {
                type: 'string',
                description: 'purpose of this action',
              },
              amount: {
                type: 'integer',
                nullable: true,
              },
            },
            required: ['intent', 'amount'],
          },
          scroll_up: {
            type: 'object',
            description: 'Scroll up the page by pixel amount - if no amount is specified, scroll up one page',
            nullable: true,
            properties: {
              intent: {
                type: 'string',
                description: 'purpose of this action',
              },
              amount: {
                type: 'integer',
                nullable: true,
              },
            },
            required: ['intent', 'amount'],
          },
          send_keys: {
            type: 'object',
            description:
              'Send strings of special keys like Escape, Backspace, Insert, PageDown, Delete, Enter, Shortcuts such as `Control+o`, `Control+Shift+T` are supported as well. This gets used in keyboard.press.',
            nullable: true,
            properties: {
              intent: {
                type: 'string',
                description: 'purpose of this action',
              },
              keys: {
                type: 'string',
              },
            },
            required: ['intent', 'keys'],
          },
          scroll_to_text: {
            type: 'object',
            description: 'If you dont find something which you want to interact with, scroll to it',
            nullable: true,
            properties: {
              intent: {
                type: 'string',
                description: 'purpose of this action',
              },
              text: {
                type: 'string',
              },
            },
            required: ['intent', 'text'],
          },
          get_dropdown_options: {
            type: 'object',
            description: 'Get all options from a native dropdown',
            nullable: true,
            properties: {
              intent: {
                type: 'string',
                description: 'purpose of this action',
              },
              index: {
                type: 'integer',
              },
            },
            required: ['intent', 'index'],
          },
          select_dropdown_option: {
            type: 'object',
            description:
              'Select dropdown option for interactive element index by the text of the option you want to select',
            nullable: true,
            properties: {
              intent: {
                type: 'string',
                description: 'purpose of this action',
              },
              index: {
                type: 'integer',
              },
              text: {
                type: 'string',
              },
            },
            required: ['intent', 'index', 'text'],
          },
        },
      },
    },
  },
  required: ['current_state', 'action'],
};
