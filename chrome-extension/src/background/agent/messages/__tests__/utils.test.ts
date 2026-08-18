import { AIMessage } from '@langchain/core/messages';
import { describe, expect, it } from 'vitest';

import { convertInputMessages } from '../utils';

describe('convertInputMessages', () => {
  it('preserves ordinary AI message content for DeepSeek Reasoner', () => {
    const plan = new AIMessage({ content: '<plan>Keep this plan</plan>' });

    const [converted] = convertInputMessages([plan], 'deepseek-reasoner');

    expect(converted.content).toBe(plan.content);
  });
});
