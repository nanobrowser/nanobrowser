// This is the json schema exported from browser-use, change page_id to tab_id
// TODO: don't know why zod can not generate the same schema, need to fix it
export const jsonNavigatorOutputSchema = {
  properties: {
    current_state: {
      description: 'Current state of the agent',
      properties: {
        evaluation_previous_goal: {
          title: 'Evaluation of previous goal',
          type: 'string',
        },
        memory: {
          title: 'Memory',
          type: 'string',
        },
        next_goal: {
          title: 'Next Goal',
          type: 'string',
        },
      },
      required: ['evaluation_previous_goal', 'memory', 'next_goal'],
      title: 'AgentBrain',
      type: 'object',
    },
    action: {
      items: {
        properties: {
          done: {
            description: 'Complete task',
            properties: {
              text: {
                title: 'Text',
                type: 'string',
              },
              success: {
                title: 'Success',
                type: 'boolean',
              },
            },
            required: ['text', 'success'],
            title: 'DoneAction',
            type: 'object',
            nullable: true,
          },
          search_google: {
            description:
              'Search the query in Google in the current tab, the query should be a search query like humans search in Google, concrete and not vague or super long. More the single most important items. ',
            properties: {
              intent: {
                title: 'Intent',
                type: 'string',
                description: 'purpose of this action',
              },
              query: {
                title: 'Query',
                type: 'string',
              },
            },
            required: ['intent', 'query'],
            title: 'SearchGoogleAction',
            type: 'object',
            nullable: true,
          },
          go_to_url: {
            description: 'Navigate to URL in the current tab',
            properties: {
              intent: {
                title: 'Intent',
                type: 'string',
                description: 'purpose of this action',
              },
              url: {
                title: 'Url',
                type: 'string',
              },
            },
            required: ['intent', 'url'],
            title: 'GoToUrlAction',
            type: 'object',
            nullable: true,
          },
          go_back: {
            description: 'Go back to previous page',
            properties: {
              intent: {
                title: 'Intent',
                type: 'string',
                description: 'purpose of this action',
              },
            },
            required: ['intent'],
            title: 'GoBackAction',
            type: 'object',
            nullable: true,
          },
          wait: {
            description: 'Wait for x seconds default 3, do not use this action unless user asks for it',
            properties: {
              intent: {
                title: 'Intent',
                type: 'string',
                description: 'purpose of this action',
              },
              seconds: {
                title: 'Seconds',
                type: 'integer',
                default: 3,
              },
            },
            required: ['intent', 'seconds'],
            title: 'WaitAction',
            type: 'object',
            nullable: true,
          },
          click_element: {
            description: 'Click element by index',
            properties: {
              intent: {
                title: 'Intent',
                type: 'string',
                description: 'purpose of this action',
              },
              index: {
                title: 'Index',
                type: 'integer',
              },
              xpath: {
                title: 'Xpath',
                type: 'string',
                nullable: true,
              },
            },
            required: ['intent', 'index'],
            title: 'ClickElementAction',
            type: 'object',
            nullable: true,
          },
          input_text: {
            description: 'Input text into an interactive input element',
            properties: {
              intent: {
                title: 'Intent',
                type: 'string',
                description: 'purpose of this action',
              },
              index: {
                title: 'Index',
                type: 'integer',
              },
              text: {
                title: 'Text',
                type: 'string',
              },
              xpath: {
                title: 'Xpath',
                type: 'string',
                nullable: true,
              },
            },
            required: ['intent', 'index', 'text'],
            title: 'InputTextAction',
            type: 'object',
            nullable: true,
          },
          switch_tab: {
            description: 'Switch tab',
            properties: {
              intent: {
                title: 'Intent',
                type: 'string',
                description: 'purpose of this action',
              },
              tab_id: {
                title: 'Tab Id',
                type: 'integer',
              },
            },
            required: ['intent', 'tab_id'],
            title: 'SwitchTabAction',
            type: 'object',
            nullable: true,
          },
          open_tab: {
            description: 'Open url in new tab',
            properties: {
              intent: {
                title: 'Intent',
                type: 'string',
                description: 'purpose of this action',
              },
              url: {
                title: 'Url',
                type: 'string',
              },
            },
            required: ['intent', 'url'],
            title: 'OpenTabAction',
            type: 'object',
            nullable: true,
          },
          close_tab: {
            description: 'Close tab by tab_id',
            properties: {
              intent: {
                title: 'Intent',
                type: 'string',
                description: 'purpose of this action',
              },
              tab_id: {
                title: 'Tab Id',
                type: 'integer',
              },
            },
            required: ['intent', 'tab_id'],
            title: 'CloseTabAction',
            type: 'object',
            nullable: true,
          },
          cache_content: {
            description: 'Cache what you have found so far from the current page for future use',
            properties: {
              intent: {
                title: 'Intent',
                type: 'string',
                description: 'purpose of this action',
              },
              content: {
                title: 'Content',
                type: 'string',
              },
            },
            required: ['intent', 'content'],
            title: 'cache_content_parameters',
            type: 'object',
            nullable: true,
          },
          scroll_down: {
            description: 'Scroll down the page by pixel amount - if no amount is specified, scroll down one page',
            properties: {
              intent: {
                title: 'Intent',
                type: 'string',
                description: 'purpose of this action',
              },
              amount: {
                title: 'Amount',
                type: 'integer',
                nullable: true,
              },
            },
            required: ['intent', 'amount'],
            title: 'ScrollAction',
            type: 'object',
            nullable: true,
          },
          scroll_up: {
            description: 'Scroll up the page by pixel amount - if no amount is specified, scroll up one page',
            properties: {
              intent: {
                title: 'Intent',
                type: 'string',
                description: 'purpose of this action',
              },
              amount: {
                title: 'Amount',
                type: 'integer',
                nullable: true,
              },
            },
            required: ['intent', 'amount'],
            title: 'ScrollAction',
            type: 'object',
            nullable: true,
          },
          send_keys: {
            description:
              'Send strings of special keys like Escape, Backspace, Insert, PageDown, Delete, Enter, Shortcuts such as `Control+o`, `Control+Shift+T` are supported as well. This gets used in keyboard.press.',
            properties: {
              intent: {
                title: 'Intent',
                type: 'string',
                description: 'purpose of this action',
              },
              keys: {
                title: 'Keys',
                type: 'string',
              },
            },
            required: ['intent', 'keys'],
            title: 'SendKeysAction',
            type: 'object',
            nullable: true,
          },
          scroll_to_text: {
            description: 'If you dont find something which you want to interact with, scroll to it',
            properties: {
              intent: {
                title: 'Intent',
                type: 'string',
                description: 'purpose of this action',
              },
              text: {
                title: 'Text',
                type: 'string',
              },
            },
            required: ['intent', 'text'],
            title: 'scroll_to_text_parameters',
            type: 'object',
            nullable: true,
          },
          get_dropdown_options: {
            description: 'Get all options from a native dropdown',
            properties: {
              intent: {
                title: 'Intent',
                type: 'string',
                description: 'purpose of this action',
              },
              index: {
                title: 'Index',
                type: 'integer',
              },
            },
            required: ['intent', 'index'],
            title: 'get_dropdown_options_parameters',
            type: 'object',
            nullable: true,
          },
          select_dropdown_option: {
            description:
              'Select dropdown option for interactive element index by the text of the option you want to select',
            properties: {
              intent: {
                title: 'Intent',
                type: 'string',
                description: 'purpose of this action',
              },
              index: {
                title: 'Index',
                type: 'integer',
              },
              text: {
                title: 'Text',
                type: 'string',
              },
            },
            required: ['intent', 'index', 'text'],
            title: 'select_dropdown_option_parameters',
            type: 'object',
            nullable: true,
          },
        },
        title: 'ActionModel',
        type: 'object',
      },
      title: 'Action',
      type: 'array',
    },
  },
  required: ['current_state', 'action'],
  title: 'AgentOutput',
  type: 'object',
};
