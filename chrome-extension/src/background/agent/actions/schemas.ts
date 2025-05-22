import { z } from 'zod';

export interface ActionSchema {
  name: string;
  description: string;
  schema: z.ZodType;
}

export const doneActionSchema: ActionSchema = {
  name: 'done',
  description: 'Complete task',
  schema: z.object({
    text: z.string(),
    success: z.boolean(),
  }),
};

// Basic Navigation Actions
export const searchGoogleActionSchema: ActionSchema = {
  name: 'search_google',
  description: 'Search Google in the current tab',
  schema: z.object({
    intent: z.string().optional(),
    query: z.string(),
  }),
};

export const goToUrlActionSchema: ActionSchema = {
  name: 'go_to_url',
  description: 'Navigate to URL in the current tab',
  schema: z.object({
    intent: z.string().optional(),
    url: z.string(),
  }),
};

export const goBackActionSchema: ActionSchema = {
  name: 'go_back',
  description: 'Go back to the previous page',
  schema: z.object({
    intent: z.string().optional(),
  }),
};

export const clickElementActionSchema: ActionSchema = {
  name: 'click_element',
  description: 'Click element by index',
  schema: z.object({
    intent: z.string().optional(), // some small LLM can not generate a intent, so let it be optional (but it's still makred as required in json schema)
    index: z.number(),
    xpath: z.string().nullable().optional(),
  }),
};

export const inputTextActionSchema: ActionSchema = {
  name: 'input_text',
  description: 'Input text into an interactive input element',
  schema: z.object({
    intent: z.string().optional(),
    index: z.number(),
    text: z.string(),
    xpath: z.string().nullable().optional(),
  }),
};

// Tab Management Actions
export const switchTabActionSchema: ActionSchema = {
  name: 'switch_tab',
  description: 'Switch to tab by id',
  schema: z.object({
    intent: z.string().optional(),
    tab_id: z.number(),
  }),
};

export const openTabActionSchema: ActionSchema = {
  name: 'open_tab',
  description: 'Open URL in new tab',
  schema: z.object({
    intent: z.string().optional(),
    url: z.string(),
  }),
};

export const closeTabActionSchema: ActionSchema = {
  name: 'close_tab',
  description: 'Close tab by id',
  schema: z.object({
    intent: z.string().optional(),
    tab_id: z.number(),
  }),
};

// Content Actions, not used currently
// export const extractContentActionSchema: ActionSchema = {
//   name: 'extract_content',
//   description:
//     'Extract page content to retrieve specific information from the page, e.g. all company names, a specific description, all information about, links with companies in structured format or simply links',
//   schema: z.object({
//     goal: z.string(),
//   }),
// };

// Cache Actions
export const cacheContentActionSchema: ActionSchema = {
  name: 'cache_content',
  description: 'Cache what you have found so far from the current page for future use',
  schema: z.object({
    intent: z.string().optional(),
    content: z.string(),
  }),
};

export const scrollDownActionSchema: ActionSchema = {
  name: 'scroll_down',
  description: 'Scroll down the page by pixel amount - if no amount is specified, scroll down one page',
  schema: z.object({
    intent: z.string().optional(),
    amount: z.number().nullable().optional(),
  }),
};

export const scrollUpActionSchema: ActionSchema = {
  name: 'scroll_up',
  description: 'Scroll up the page by pixel amount - if no amount is specified, scroll up one page',
  schema: z.object({
    intent: z.string().optional(),
    amount: z.number().nullable().optional(),
  }),
};

export const sendKeysActionSchema: ActionSchema = {
  name: 'send_keys',
  description:
    'Send strings of special keys like Backspace, Insert, PageDown, Delete, Enter. Shortcuts such as `Control+o`, `Control+Shift+T` are supported as well. This gets used in keyboard press. Be aware of different operating systems and their shortcuts',
  schema: z.object({
    intent: z.string().optional(),
    keys: z.string(),
  }),
};

export const scrollToTextActionSchema: ActionSchema = {
  name: 'scroll_to_text',
  description: 'If you dont find something which you want to interact with, scroll to it',
  schema: z.object({
    intent: z.string().optional(),
    text: z.string(),
  }),
};

export const getDropdownOptionsActionSchema: ActionSchema = {
  name: 'get_dropdown_options',
  description: 'Get all options from a native dropdown',
  schema: z.object({
    intent: z.string().optional(),
    index: z.number(),
  }),
};

export const selectDropdownOptionActionSchema: ActionSchema = {
  name: 'select_dropdown_option',
  description: 'Select dropdown option for interactive element index by the text of the option you want to select',
  schema: z.object({
    intent: z.string().optional(),
    index: z.number(),
    text: z.string(),
  }),
};

export const waitActionSchema: ActionSchema = {
  name: 'wait',
  description: 'Wait for x seconds default 3, do not use this action unless user asks for it',
  schema: z.object({
    intent: z.string().optional(),
    seconds: z.number().nullable().optional(),
  }),
};
