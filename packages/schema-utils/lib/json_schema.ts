// This is the json schema exported from browser-use v0.1.41 with minor changes,
//  - change page_id to tab_id
//  - add intent to some actions which is used to describe the action's purpose
//  - remove extract_content action, because it usually submit very long content to LLM
//  - remove DragDropAction, it's not supported yet
//  - remove save_pdf action, it's not supported yet
//  - remove Position, not needed
//  - remove NoParamsAction, not needed
// TODO: don't know why zod can not generate the same schema, need to fix it
export const jsonNavigatorOutputSchema = {
  $defs: {
    ActionModel: {
      properties: {
        done: {
          anyOf: [
            {
              $ref: '#/$defs/DoneAction',
            },
            {
              type: 'null',
            },
          ],
          description: 'Complete task',
        },
        search_google: {
          anyOf: [
            {
              $ref: '#/$defs/SearchGoogleAction',
            },
            {
              type: 'null',
            },
          ],
          description:
            'Search the query in Google in the current tab, the query should be a search query like humans search in Google, concrete and not vague or super long. More the single most important items. ',
        },
        go_to_url: {
          anyOf: [
            {
              $ref: '#/$defs/GoToUrlAction',
            },
            {
              type: 'null',
            },
          ],
          description: 'Navigate to URL in the current tab',
        },
        go_back: {
          anyOf: [
            {
              $ref: '#/$defs/GoBackAction',
            },
            {
              type: 'null',
            },
          ],
          description: 'Go back to previous page',
        },
        wait: {
          anyOf: [
            {
              $ref: '#/$defs/WaitAction',
            },
            {
              type: 'null',
            },
          ],
          description: 'Wait for x seconds default 3',
        },
        click_element: {
          anyOf: [
            {
              $ref: '#/$defs/ClickElementAction',
            },
            {
              type: 'null',
            },
          ],
          description: 'Click element by index',
        },
        input_text: {
          anyOf: [
            {
              $ref: '#/$defs/InputTextAction',
            },
            {
              type: 'null',
            },
          ],
          description: 'Input text into an interactive input element',
        },
        switch_tab: {
          anyOf: [
            {
              $ref: '#/$defs/SwitchTabAction',
            },
            {
              type: 'null',
            },
          ],
          description: 'Switch tab',
        },
        open_tab: {
          anyOf: [
            {
              $ref: '#/$defs/OpenTabAction',
            },
            {
              type: 'null',
            },
          ],
          description: 'Open url in new tab',
        },
        close_tab: {
          anyOf: [
            {
              $ref: '#/$defs/CloseTabAction',
            },
            {
              type: 'null',
            },
          ],
          description: 'Close tab by tab_id',
        },

        cache_content: {
          anyOf: [
            {
              $ref: '#/$defs/cache_content_parameters',
            },
            {
              type: 'null',
            },
          ],
          description: 'Cache what you have found so far from the current page for future use',
        },
        scroll_down: {
          anyOf: [
            {
              $ref: '#/$defs/ScrollAction',
            },
            {
              type: 'null',
            },
          ],
          description: 'Scroll down the page by pixel amount - if no amount is specified, scroll down one page',
        },
        scroll_up: {
          anyOf: [
            {
              $ref: '#/$defs/ScrollAction',
            },
            {
              type: 'null',
            },
          ],
          description: 'Scroll up the page by pixel amount - if no amount is specified, scroll up one page',
        },
        send_keys: {
          anyOf: [
            {
              $ref: '#/$defs/SendKeysAction',
            },
            {
              type: 'null',
            },
          ],
          description:
            'Send strings of special keys like Escape, Backspace, Insert, PageDown, Delete, Enter, Shortcuts such as `Control+o`, `Control+Shift+T` are supported as well. This gets used in keyboard.press.',
        },
        scroll_to_text: {
          anyOf: [
            {
              $ref: '#/$defs/scroll_to_text_parameters',
            },
            {
              type: 'null',
            },
          ],
          description: 'If you dont find something which you want to interact with, scroll to it',
        },
        get_dropdown_options: {
          anyOf: [
            {
              $ref: '#/$defs/get_dropdown_options_parameters',
            },
            {
              type: 'null',
            },
          ],
          description: 'Get all options from a native dropdown',
        },
        select_dropdown_option: {
          anyOf: [
            {
              $ref: '#/$defs/select_dropdown_option_parameters',
            },
            {
              type: 'null',
            },
          ],
          description:
            'Select dropdown option for interactive element index by the text of the option you want to select',
        },
        set_memory: {
          anyOf: [
            {
              $ref: '#/$defs/set_memory_parameters',
            },
            {
              type: 'null',
            },
          ],
          description: 'Store a value in memory that persists across agent steps',
        },
        get_memory: {
          anyOf: [
            {
              $ref: '#/$defs/get_memory_parameters',
            },
            {
              type: 'null',
            },
          ],
          description: 'Retrieve a value from memory',
        },
        increment_counter: {
          anyOf: [
            {
              $ref: '#/$defs/increment_counter_parameters',
            },
            {
              type: 'null',
            },
          ],
          description: 'Increment a numeric counter in memory, perfect for tracking counts of items processed',
        },
        get_all_memory: {
          anyOf: [
            {
              $ref: '#/$defs/get_all_memory_parameters',
            },
            {
              type: 'null',
            },
          ],
          description: 'Get all data stored in memory',
        },
      },
      title: 'ActionModel',
      type: 'object',
    },
    AgentBrain: {
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
    ClickElementAction: {
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
          anyOf: [
            {
              type: 'string',
            },
            {
              type: 'null',
            },
          ],
          title: 'Xpath',
        },
      },
      required: ['intent', 'index'],
      title: 'ClickElementAction',
      type: 'object',
    },
    CloseTabAction: {
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
    },
    DoneAction: {
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
    },
    GoToUrlAction: {
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
    },
    GoBackAction: {
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
    },
    InputTextAction: {
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
          anyOf: [
            {
              type: 'string',
            },
            {
              type: 'null',
            },
          ],
          title: 'Xpath',
        },
      },
      required: ['intent', 'index', 'text'],
      title: 'InputTextAction',
      type: 'object',
    },
    OpenTabAction: {
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
    },
    ScrollAction: {
      properties: {
        intent: {
          title: 'Intent',
          type: 'string',
          description: 'purpose of this action',
        },
        amount: {
          anyOf: [
            {
              type: 'integer',
            },
            {
              type: 'null',
            },
          ],
          title: 'Amount',
        },
      },
      required: ['intent', 'amount'],
      title: 'ScrollAction',
      type: 'object',
    },
    SearchGoogleAction: {
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
    },
    SendKeysAction: {
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
    },
    SwitchTabAction: {
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
    },
    cache_content_parameters: {
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
    },
    get_dropdown_options_parameters: {
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
    },
    scroll_to_text_parameters: {
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
    },
    select_dropdown_option_parameters: {
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
    },
    WaitAction: {
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
    },
    set_memory_parameters: {
      properties: {
        intent: {
          title: 'Intent',
          type: 'string',
          description: 'Optional description of why this memory is being set',
        },
        key: {
          title: 'Key',
          type: 'string',
          description: 'The key under which to store the value',
        },
        value: {
          title: 'Value',
          description: 'The value to store in memory',
        },
      },
      required: ['key', 'value'],
      title: 'set_memory_parameters',
      type: 'object',
    },
    get_memory_parameters: {
      properties: {
        intent: {
          title: 'Intent',
          type: 'string',
          description: 'Optional description of why this memory is being accessed',
        },
        key: {
          title: 'Key',
          type: 'string',
          description: 'The key to retrieve from memory',
        },
      },
      required: ['key'],
      title: 'get_memory_parameters',
      type: 'object',
    },
    increment_counter_parameters: {
      properties: {
        intent: {
          title: 'Intent',
          type: 'string',
          description: 'Optional description of why this counter is being incremented',
        },
        key: {
          title: 'Key',
          type: 'string',
          description: 'The counter key to increment',
        },
        increment: {
          title: 'Increment',
          type: 'integer',
          description: 'Amount to increment by (default: 1)',
          nullable: true,
        },
      },
      required: ['key'],
      title: 'increment_counter_parameters',
      type: 'object',
    },
    get_all_memory_parameters: {
      properties: {
        intent: {
          title: 'Intent',
          type: 'string',
          description: 'Optional description of why all memory is being retrieved',
        },
      },
      title: 'get_all_memory_parameters',
      type: 'object',
    },
  },
  properties: {
    current_state: {
      $ref: '#/$defs/AgentBrain',
    },
    action: {
      items: {
        $ref: '#/$defs/ActionModel',
      },
      title: 'Action',
      type: 'array',
    },
  },
  required: ['current_state', 'action'],
  title: 'AgentOutput',
  type: 'object',
};
