// Which key a press or a typed text actually dispatches, for the confirmation gate and policy layer 2.
// The classification follows the key Puppeteer sends, not the name the agent wrote: its US layout sends Enter for
// "Enter", "NumpadEnter", "\r" and "\n", and Space for "Space" and " ".

export type KeyMode = 'activate' | 'enter' | 'none';

/** The element a key goes to, as far as the gate cares. */
export interface KeyElement {
  tag: string;
  type: string;
  contentEditable?: boolean;
}

/** A chord split as the page port presses it: parts trimmed, empty parts dropped, the last part is the key. */
export function splitChord(keys: string): { modifiers: string[]; key: string } {
  const parts = keys
    .split('+')
    .map(p => p.trim())
    .filter(Boolean);
  const key = parts.pop() ?? '';
  return { modifiers: parts, key };
}

/** The key Puppeteer dispatches for a key name or a typed character, as far as the gate cares. */
export function dispatchedKey(key: string): string {
  if (key === 'Enter' || key === 'NumpadEnter' || key === '\r' || key === '\n') return 'Enter';
  if (key === ' ' || key === 'Space') return 'Space';
  return key;
}

/**
 * Whether releasing a key is what activates: Space clicks a button, a checkbox, a radio or a summary on keyup, where
 * Enter acts on keydown. What the release does is decided when it arrives, after the keydown's handlers ran.
 */
export function releaseActivates(key: string): boolean {
  return dispatchedKey(key) === 'Space';
}

const BUTTON_TYPES = ['button', 'submit', 'image', 'reset'];
const TOGGLE_TYPES = ['checkbox', 'radio'];

/**
 * What a pressed key does to an element. Enter in an input (a checkbox or radio included), a select or a textarea
 * may submit its form; Enter or Space on a button, link or any other element activates it; Space toggles a checkbox
 * or radio; Space in a field or textarea is text. Errs toward a prompt: a false positive costs one question.
 */
export function keyMode(key: string, el: KeyElement): KeyMode {
  const k = dispatchedKey(key);
  if (k !== 'Enter' && k !== 'Space') return 'none';
  const button = el.tag === 'input' && BUTTON_TYPES.includes(el.type);
  if ((el.tag === 'input' && !button) || el.tag === 'select' || el.tag === 'textarea') {
    if (k === 'Enter') return 'enter';
    return el.tag === 'input' && TOGGLE_TYPES.includes(el.type) ? 'activate' : 'none';
  }
  return 'activate';
}

/**
 * The key in a typed text that can submit or activate: typing presses a key for every character the layout knows,
 * so "\n" or "\r" is Enter and " " is Space. Enter is returned before Space.
 */
export function typedKey(text: string): 'Enter' | 'Space' | null {
  if (/[\r\n]/.test(text)) return 'Enter';
  if (text.includes(' ')) return 'Space';
  return null;
}

const STRENGTH: Record<KeyMode, number> = { none: 0, activate: 1, enter: 2 };

/**
 * What typing a text (then Enter, with submit) does to an element. Typed keys in a textarea or a contenteditable
 * only edit it; elsewhere they count as presses. The stronger mode wins when both apply.
 */
export function typedMode(text: string, submit: boolean, el: KeyElement): KeyMode {
  const typed = typedKey(text);
  const editsText = el.tag === 'textarea' || !!el.contentEditable;
  const fromText = typed && !editsText ? keyMode(typed, el) : 'none';
  const fromSubmit = submit ? keyMode('Enter', el) : 'none';
  return STRENGTH[fromSubmit] >= STRENGTH[fromText] ? fromSubmit : fromText;
}
