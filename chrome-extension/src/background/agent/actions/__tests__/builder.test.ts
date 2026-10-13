import { describe, expect, it, vi } from 'vitest';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { AgentContext } from '../../types';
import { ActionBuilder, InvalidInputError } from '../builder';

const DATE_ELEMENT_INDEX = 4;
const ISO_DATE = '2026-10-10';
const SELECT_DATE_ACTION = 'select_date';

describe('ActionBuilder date action', () => {
  it('registers a date action and delegates valid ISO dates to the page', async () => {
    const selectDate = vi.fn().mockResolvedValue(`Selected date "${ISO_DATE}"`);
    const emitEvent = vi.fn();
    const context = {
      browserContext: {
        getCurrentPage: vi.fn().mockResolvedValue({ selectDate }),
      },
      emitEvent,
    } as unknown as AgentContext;
    const builder = new ActionBuilder(context, {} as BaseChatModel);
    const action = builder.buildDefaultActions().find(candidate => candidate.name() === SELECT_DATE_ACTION);

    expect(action).toBeDefined();
    const result = await action?.call({ index: DATE_ELEMENT_INDEX, date: ISO_DATE });

    expect(selectDate).toHaveBeenCalledWith(DATE_ELEMENT_INDEX, ISO_DATE);
    expect(result?.error).toBeNull();
    expect(result?.extractedContent).toContain(ISO_DATE);
    expect(emitEvent).toHaveBeenCalledTimes(2);
  });

  it('rejects dates that are not in ISO format before invoking the page', async () => {
    const context = {
      browserContext: { getCurrentPage: vi.fn() },
      emitEvent: vi.fn(),
    } as unknown as AgentContext;
    const builder = new ActionBuilder(context, {} as BaseChatModel);
    const action = builder.buildDefaultActions().find(candidate => candidate.name() === SELECT_DATE_ACTION);

    await expect(action?.call({ index: DATE_ELEMENT_INDEX, date: 'October 10, 2026' })).rejects.toBeInstanceOf(
      InvalidInputError,
    );
    expect(context.browserContext.getCurrentPage).not.toHaveBeenCalled();
  });

  it('returns an action error when the page cannot set the date', async () => {
    const failureMessage = 'Date input not found';
    const context = {
      browserContext: {
        getCurrentPage: vi.fn().mockResolvedValue({ selectDate: vi.fn().mockRejectedValue(new Error(failureMessage)) }),
      },
      emitEvent: vi.fn(),
    } as unknown as AgentContext;
    const builder = new ActionBuilder(context, {} as BaseChatModel);
    const action = builder.buildDefaultActions().find(candidate => candidate.name() === SELECT_DATE_ACTION);

    const result = await action?.call({ index: DATE_ELEMENT_INDEX, date: ISO_DATE });

    expect(result?.error).toContain(failureMessage);
    expect(context.emitEvent).toHaveBeenCalledTimes(2);
  });
});
