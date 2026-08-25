import { afterEach, describe, expect, it, vi } from 'vitest';
import Page from '../page';
import { DOMElementNode } from '../dom/views';

vi.mock('webextension-polyfill', () => ({ default: {} }));

const DATE_ELEMENT_INDEX = 7;
const ISO_DATE = '2026-10-10';
const DATE_INPUT_TYPE = 'date';
const DATE_INPUT_TAG = 'input';
const DATE_INPUT_XPATH = '//input[@type="date"]';
const PAGE_URL = 'https://example.com/form';
const TAB_ID = 1;
const FORM_TITLE = 'Form';
const TEXT_INPUT_TYPE = 'text';
const NON_ISO_DATE = 'October 10, 2026';

class FakeEvent {
  constructor(
    public readonly type: string,
    public readonly options: EventInit,
  ) {}
}

class FakeHTMLInputElement {
  readonly type: string = DATE_INPUT_TYPE;
  private dateValue = '';
  readonly dispatchEvent = vi.fn();

  constructor(private readonly acceptsDate = true) {}

  get value() {
    return this.dateValue;
  }

  set value(date: string) {
    if (this.acceptsDate) {
      this.dateValue = date;
    }
  }
}

class TrackedFakeHTMLInputElement extends FakeHTMLInputElement {
  trackerAssignments = 0;

  constructor() {
    super();
    const nativeValue = Object.getOwnPropertyDescriptor(FakeHTMLInputElement.prototype, 'value');
    Object.defineProperty(this, 'value', {
      configurable: true,
      get: () => nativeValue?.get?.call(this),
      set: date => {
        this.trackerAssignments += 1;
        nativeValue?.set?.call(this, date);
      },
    });
  }
}

function createPage(input: FakeHTMLInputElement = new FakeHTMLInputElement()) {
  const page = new Page(TAB_ID, PAGE_URL, FORM_TITLE);
  const dateElement = new DOMElementNode({
    tagName: DATE_INPUT_TAG,
    isVisible: true,
    parent: null,
    xpath: DATE_INPUT_XPATH,
    attributes: { type: DATE_INPUT_TYPE },
    children: [],
  });
  const elementHandle = {
    evaluate: vi.fn(async (callback, ...args: unknown[]) => callback(input, ...args)),
  };
  const pageInternals = page as unknown as {
    _puppeteerPage: object;
    _cachedState: { selectorMap: Map<number, DOMElementNode> };
    locateElement: () => Promise<typeof elementHandle | null>;
    selectDate: (index: number, date: string) => Promise<string>;
  };
  pageInternals._puppeteerPage = {};
  pageInternals._cachedState = { selectorMap: new Map([[DATE_ELEMENT_INDEX, dateElement]]) };
  pageInternals.locateElement = vi.fn().mockResolvedValue(elementHandle);
  return { dateElement, elementHandle, input, pageInternals };
}

describe('Page date selectors', () => {
  const originalEvent = globalThis.Event;
  const originalHTMLInputElement = globalThis.HTMLInputElement;

  afterEach(() => {
    globalThis.Event = originalEvent;
    globalThis.HTMLInputElement = originalHTMLInputElement;
    vi.restoreAllMocks();
  });

  it('sets a native date input and dispatches input and change events', async () => {
    globalThis.Event = FakeEvent as unknown as typeof Event;
    globalThis.HTMLInputElement = FakeHTMLInputElement as unknown as typeof HTMLInputElement;

    const { input, pageInternals } = createPage();

    const result = await pageInternals.selectDate(DATE_ELEMENT_INDEX, ISO_DATE);

    expect(input.value).toBe(ISO_DATE);
    expect(input.dispatchEvent).toHaveBeenCalledTimes(2);
    expect(input.dispatchEvent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ type: 'input', options: { bubbles: true } }),
    );
    expect(input.dispatchEvent).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ type: 'change', options: { bubbles: true } }),
    );
    expect(result).toContain(ISO_DATE);
  });

  it('bypasses framework value trackers with the native input setter', async () => {
    globalThis.Event = FakeEvent as unknown as typeof Event;
    globalThis.HTMLInputElement = FakeHTMLInputElement as unknown as typeof HTMLInputElement;
    const input = new TrackedFakeHTMLInputElement();
    const { pageInternals } = createPage(input);

    await pageInternals.selectDate(DATE_ELEMENT_INDEX, ISO_DATE);

    expect(input.value).toBe(ISO_DATE);
    expect(input.trackerAssignments).toBe(0);
  });

  it('rejects missing, non-date, and invalid date inputs', async () => {
    const { dateElement, pageInternals } = createPage();

    pageInternals._cachedState.selectorMap.clear();
    await expect(pageInternals.selectDate(DATE_ELEMENT_INDEX, ISO_DATE)).rejects.toThrow('Element not found');

    dateElement.attributes.type = TEXT_INPUT_TYPE;
    pageInternals._cachedState.selectorMap.set(DATE_ELEMENT_INDEX, dateElement);
    await expect(pageInternals.selectDate(DATE_ELEMENT_INDEX, ISO_DATE)).rejects.toThrow('not a native date input');

    dateElement.attributes.type = DATE_INPUT_TYPE;
    await expect(pageInternals.selectDate(DATE_ELEMENT_INDEX, NON_ISO_DATE)).rejects.toThrow('YYYY-MM-DD');
  });

  it('reports date inputs that cannot be located or reject the assigned date', async () => {
    globalThis.HTMLInputElement = FakeHTMLInputElement as unknown as typeof HTMLInputElement;
    const { elementHandle, pageInternals } = createPage();

    pageInternals.locateElement = vi.fn().mockResolvedValue(null);
    await expect(pageInternals.selectDate(DATE_ELEMENT_INDEX, ISO_DATE)).rejects.toThrow('not found');

    pageInternals.locateElement = vi.fn().mockResolvedValue(elementHandle);
    elementHandle.evaluate.mockResolvedValue(false);
    await expect(pageInternals.selectDate(DATE_ELEMENT_INDEX, ISO_DATE)).rejects.toThrow('Unable to set date');

    elementHandle.evaluate.mockImplementation(async (callback, ...args: unknown[]) =>
      callback(new FakeHTMLInputElement(), ...args),
    );
    const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
    const descriptorSpy = vi
      .spyOn(Object, 'getOwnPropertyDescriptor')
      .mockImplementation((target, key) =>
        target === FakeHTMLInputElement.prototype && key === 'value'
          ? undefined
          : getOwnPropertyDescriptor(target, key),
      );
    await expect(pageInternals.selectDate(DATE_ELEMENT_INDEX, ISO_DATE)).rejects.toThrow('Unable to set date');
    descriptorSpy.mockRestore();
  });

  it('rejects handles that are not date inputs or refuse the assigned value', async () => {
    globalThis.HTMLInputElement = FakeHTMLInputElement as unknown as typeof HTMLInputElement;
    const { elementHandle, pageInternals } = createPage();

    elementHandle.evaluate.mockImplementation(async (callback, ...args: unknown[]) =>
      callback({ type: DATE_INPUT_TYPE, value: '' }, ...args),
    );
    await expect(pageInternals.selectDate(DATE_ELEMENT_INDEX, ISO_DATE)).rejects.toThrow('Unable to set date');

    const rejectingInput = new FakeHTMLInputElement(false);
    elementHandle.evaluate.mockImplementation(async (callback, ...args: unknown[]) =>
      callback(rejectingInput, ...args),
    );
    await expect(pageInternals.selectDate(DATE_ELEMENT_INDEX, ISO_DATE)).rejects.toThrow('Unable to set date');
  });
});
