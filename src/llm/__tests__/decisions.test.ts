import { describe, expect, it, vi } from 'vitest';
import { decisionRequestSchema, makeDecision } from '../decisions';

function fakeFetch(answer: unknown, status = 200) {
  return vi.fn(async () => new Response(JSON.stringify(answer), { status })) as unknown as typeof fetch;
}

const predicate = { name: 'billing', type: 'predicate' as const, instructions: 'Is this about billing?' };
const usage = { input_tokens: 120, output_tokens: 12 };

describe('decision providers', () => {
  it('sends a Jev Noul and normalizes its named probability and usage', async () => {
    const fetch = fakeFetch({
      model: 'jev-1.13.0',
      answers: { billing: { type: 'noul', noul: 0.98 } },
      usage,
    });
    const result = await makeDecision(
      { provider: 'jev', apiKey: 'test-key' },
      { state: 'I was charged twice.', questions: [predicate] },
      { fetch },
    );
    expect(fetch).toHaveBeenCalledWith(
      'https://api.typesafe.ai/v1/systemone',
      expect.objectContaining({
        method: 'POST',
        headers: { Authorization: 'Bearer test-key', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'jev-latest',
          state: 'I was charged twice.',
          questions: {
            billing: { type: 'noul', instructions: predicate.instructions },
          },
        }),
        signal: expect.any(AbortSignal),
      }),
    );
    expect(result).toEqual({
      provider: 'jev',
      model: 'jev-1.13.0',
      answers: [{ type: 'predicate', name: 'billing', probability: 0.98 }],
      usage: { inputTokens: 120, outputTokens: 12 },
    });
  });
});

it('validates bounded, uniquely named predicate, choice, and score questions', () => {
  const choice = {
    name: 'team',
    type: 'choice',
    instructions: 'Choose a team',
    choices: [{ value: 'sales' }, { value: 'support' }],
  };
  const score = {
    name: 'urgency',
    type: 'score',
    instructions: 'Rate urgency',
    levels: [{ label: 'low' }, { label: 'high' }],
  };
  const valid = { state: 'Context', questions: [predicate, choice, score] };
  expect(decisionRequestSchema.parse(valid)).toEqual(valid);
  const invalid = [
    { ...valid, state: '' },
    { ...valid, state: 'x'.repeat(200_001) },
    { ...valid, questions: [] },
    { ...valid, questions: Array.from({ length: 21 }, (_, i) => ({ ...predicate, name: `q${i}` })) },
    { ...valid, questions: [predicate, predicate] },
    { ...valid, questions: [{ ...predicate, name: ' ' }] },
    { ...valid, questions: [{ ...choice, choices: [{ value: 'same' }, { value: 'same' }] }] },
    { ...valid, questions: [{ ...score, levels: [{ label: 'same' }, { label: 'same' }] }] },
    { ...valid, questions: [{ ...score, levels: Array.from({ length: 11 }, (_, i) => ({ label: `level ${i}` })) }] },
    { ...valid, questions: [{ ...predicate, instructions: 'x'.repeat(4001) }] },
  ];
  for (const request of invalid) expect(decisionRequestSchema.safeParse(request).success).toBe(false);
});

it('uses the dedicated OpenAI Decisions endpoint and its input and question array', async () => {
  const fetch = fakeFetch({
    model: 'gpt-6-luna',
    answers: [{ ...predicate, instructions: undefined, probability: 0.75 }],
    usage,
  });
  const result = await makeDecision(
    { provider: 'openai', apiKey: 'openai-test' },
    { state: 'A bill', questions: [predicate] },
    { fetch },
  );
  expect(fetch).toHaveBeenCalledWith(
    'https://api.openai.com/v1/decisions',
    expect.objectContaining({
      body: JSON.stringify({ model: 'gpt-6-luna', input: 'A bill', questions: [predicate] }),
    }),
  );
  expect(result.answers).toEqual([{ name: 'billing', type: 'predicate', probability: 0.75 }]);
});

const choice = {
  name: 'team',
  type: 'choice' as const,
  instructions: 'Choose a team',
  choices: [{ value: 'sales', description: 'New purchases' }, { value: 'support' }],
};
const score = {
  name: 'urgency',
  type: 'score' as const,
  instructions: 'Rate urgency',
  levels: [
    { label: 'Low', description: 'Can wait' },
    { label: 'High', description: 'Needs attention today' },
  ],
};
const choiceAnswer = {
  name: 'team',
  type: 'choice',
  choice: 'sales',
  confidence: 0.6,
  probabilities: [
    { value: 'sales', probability: 0.8 },
    { value: 'support', probability: 0.2 },
  ],
};
const scoreAnswer = {
  name: 'urgency',
  type: 'score',
  score: 0.75,
  confidence: 0.5,
  probabilities: [
    { value: 0, label: 'Low', probability: 0.25 },
    { value: 1, label: 'High', probability: 0.75 },
  ],
};

it('translates Jev choice criteria and score levels and retains the full distributions', async () => {
  const fetch = fakeFetch({
    model: 'jev-latest',
    usage,
    answers: {
      team: { type: 'choice', choice: 'sales', confidence: 0.6, probabilities: { sales: 0.8, support: 0.2 } },
      urgency: {
        type: 'score',
        score: 0.75,
        confidence: 0.5,
        legend: { '0': 'Low: Can wait', '1': 'High: Needs attention today' },
        probabilities: { '0': 0.25, '1': 0.75 },
      },
    },
  });
  const result = await makeDecision(
    { provider: 'jev', apiKey: 'k' },
    { state: 'Ticket', questions: [choice, score] },
    { fetch },
  );
  const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body));
  expect(body.questions).toEqual({
    team: { type: 'choice', instructions: choice.instructions, criteria: { sales: 'New purchases', support: null } },
    urgency: {
      type: 'score',
      instructions: score.instructions,
      criteria: ['Low: Can wait', 'High: Needs attention today'],
    },
  });
  expect(result.answers).toEqual([choiceAnswer, scoreAnswer]);
});

it('validates OpenAI choices, score rubrics, names, and refusals before returning answers', async () => {
  const request = { state: 'Ticket', questions: [choice, score, predicate] };
  const answers = [choiceAnswer, scoreAnswer, { name: 'billing', type: 'refusal' }];
  const valid = await makeDecision({ provider: 'openai', apiKey: 'k' }, request, {
    fetch: fakeFetch({ model: 'gpt-6-luna', usage, answers }),
  });
  expect(valid.answers).toEqual(answers);
  const malformed = [
    answers.slice(0, 2),
    [answers[1], answers[0], answers[2]],
    [{ ...choiceAnswer, choice: 'unknown' }, answers[1], answers[2]],
    [{ ...choiceAnswer, confidence: 1.1 }, answers[1], answers[2]],
    [{ ...choiceAnswer, probabilities: [{ value: 'sales', probability: 1 }] }, answers[1], answers[2]],
    [
      {
        ...choiceAnswer,
        probabilities: [
          { value: 'sales', probability: 0.5 },
          { value: 'sales', probability: 0.5 },
        ],
      },
      answers[1],
      answers[2],
    ],
    [answers[0], { ...scoreAnswer, score: 100 }, answers[2]],
    [
      answers[0],
      { ...scoreAnswer, probabilities: scoreAnswer.probabilities.map(p => ({ ...p, label: 'wrong' })) },
      answers[2],
    ],
    [
      answers[0],
      { ...scoreAnswer, probabilities: scoreAnswer.probabilities.map(p => ({ ...p, value: 9 })) },
      answers[2],
    ],
    [answers[0], answers[1], { type: 'predicate', name: 'billing', probability: -0.1 }],
  ];
  for (const result of malformed) {
    await expect(
      makeDecision({ provider: 'openai', apiKey: 'k' }, request, {
        fetch: fakeFetch({ model: 'gpt-6-luna', usage, answers: result }),
      }),
    ).rejects.toMatchObject({ code: 'invalid-response' });
  }
});

it('rejects Jev mismatched names, types, distributions, or score legends', async () => {
  const answers = {
    billing: { type: 'noul', noul: 0.9 },
    team: { type: 'choice', choice: 'sales', confidence: 0.6, probabilities: { sales: 0.8, support: 0.2 } },
    urgency: {
      type: 'score',
      score: 0.75,
      confidence: 0.5,
      legend: { '0': 'Low: Can wait', '1': 'High: Needs attention today' },
      probabilities: { '0': 0.25, '1': 0.75 },
    },
  };
  const malformed = [
    { ...answers, extra: answers.billing },
    { ...answers, billing: { type: 'noul', noul: 1.01 } },
    { ...answers, billing: { type: 'predicate', probability: 0.5 } },
    { ...answers, team: { ...answers.team, choice: 'unknown' } },
    { ...answers, team: { ...answers.team, probabilities: { sales: 0.8, other: 0.2 } } },
    { ...answers, team: { ...answers.team, probabilities: { sales: 0.8, support: 0.8 } } },
    { ...answers, urgency: { ...answers.urgency, legend: { '0': 'wrong', '1': 'wrong' } } },
    { ...answers, urgency: { ...answers.urgency, probabilities: { '0': 0.25, '2': 0.75 } } },
    { ...answers, urgency: { ...answers.urgency, confidence: -0.1 } },
    { ...answers, urgency: { ...answers.urgency, score: Number.POSITIVE_INFINITY } },
    { team: answers.team, urgency: answers.urgency },
  ];
  for (const result of malformed) {
    await expect(
      makeDecision(
        { provider: 'jev', apiKey: 'k' },
        { state: 'Ticket', questions: [predicate, choice, score] },
        { fetch: fakeFetch({ model: 'jev-latest', usage, answers: result }) },
      ),
    ).rejects.toMatchObject({ code: 'invalid-response' });
  }
});

it('rejects missing credentials and invalid requests before sending any data', async () => {
  const fetch = fakeFetch({ model: 'jev-latest', usage, answers: { billing: { type: 'noul', noul: 0.5 } } });
  await expect(
    makeDecision({ provider: 'jev', apiKey: 'k' }, { state: '', questions: [predicate] }, { fetch }),
  ).rejects.toMatchObject({ code: 'invalid-request' });
  await expect(
    makeDecision({ provider: 'jev', apiKey: '   ' }, { state: 'Ticket', questions: [predicate] }, { fetch }),
  ).rejects.toMatchObject({ code: 'missing-key' });
  expect(fetch).not.toHaveBeenCalled();
});

it('reports HTTP status safely without reading error bodies or retrying either provider', async () => {
  for (const provider of ['jev', 'openai'] as const) {
    for (const status of [401, 403, 429, 500]) {
      const fetch = fakeFetch({ error: 'secret-key and private page content' }, status);
      const result = makeDecision(
        { provider, apiKey: 'secret-key' },
        { state: 'private page content', questions: [predicate] },
        { fetch },
      );
      await expect(result).rejects.toMatchObject({
        code: 'http',
        status,
        message: `Decision request failed (HTTP ${status}).`,
      });
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  }
});

it('sanitizes network and malformed JSON errors and rejects invalid usage', async () => {
  const request = { state: 'Ticket', questions: [predicate] };
  const network = vi.fn(async () => {
    throw new Error('secret-key in upstream detail');
  }) as unknown as typeof fetch;
  await expect(
    makeDecision({ provider: 'jev', apiKey: 'secret-key' }, request, { fetch: network }),
  ).rejects.toMatchObject({ code: 'network', message: 'The decision provider could not be reached.' });
  const invalidJson = vi.fn(async () => new Response('secret-key invalid JSON')) as unknown as typeof fetch;
  await expect(
    makeDecision({ provider: 'openai', apiKey: 'secret-key' }, request, { fetch: invalidJson }),
  ).rejects.toMatchObject({ code: 'invalid-response', message: 'The decision provider returned an invalid response.' });
  await expect(
    makeDecision({ provider: 'openai', apiKey: 'k' }, request, {
      fetch: fakeFetch({
        model: 'gpt-6-luna',
        answers: [{ name: 'billing', type: 'predicate', probability: 0.5 }],
        usage: { input_tokens: -1, output_tokens: 0 },
      }),
    }),
  ).rejects.toMatchObject({ code: 'invalid-response' });
});

it('stops before dispatch for an already canceled request and cancels an in-flight request safely', async () => {
  const request = { state: 'Ticket', questions: [predicate] };
  const canceled = new AbortController();
  canceled.abort(new Error('secret reason'));
  const unused = fakeFetch({});
  await expect(
    makeDecision({ provider: 'jev', apiKey: 'k' }, request, { fetch: unused, signal: canceled.signal }),
  ).rejects.toMatchObject({ name: 'AbortError', message: 'The decision request was canceled.' });
  expect(unused).not.toHaveBeenCalled();
  const controller = new AbortController();
  const fetch = vi.fn(
    (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('secret transport detail')), { once: true });
      }),
  ) as unknown as typeof globalThis.fetch;
  const result = makeDecision({ provider: 'openai', apiKey: 'k' }, request, { fetch, signal: controller.signal });
  controller.abort(new Error('secret caller detail'));
  await expect(result).rejects.toMatchObject({ name: 'AbortError', message: 'The decision request was canceled.' });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('aborts either provider after 30 seconds and reports a safe timeout', async () => {
  vi.useFakeTimers();
  try {
    for (const provider of ['jev', 'openai'] as const) {
      let signal: AbortSignal | undefined;
      const fetch = vi.fn(
        (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            signal = init?.signal ?? undefined;
            signal?.addEventListener('abort', () => reject(new Error('upstream detail')), { once: true });
          }),
      ) as unknown as typeof globalThis.fetch;
      const result = makeDecision({ provider, apiKey: 'k' }, { state: 'Ticket', questions: [predicate] }, { fetch });
      const observed = result.catch(error => error);
      await vi.advanceTimersByTimeAsync(29_999);
      expect(signal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(signal?.aborted).toBe(true);
      expect(await observed).toMatchObject({ code: 'timeout', message: 'The decision request timed out.' });
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  } finally {
    vi.useRealTimers();
  }
});

it('bounds successful response bodies with or without a Content-Length header', async () => {
  const body = JSON.stringify({
    model: 'gpt-6-luna',
    usage,
    answers: [{ name: 'billing', type: 'predicate', probability: 0.5 }],
  });
  for (const headers of [new Headers({ 'content-length': '2000001' }), new Headers()]) {
    const fetch = vi.fn(
      async () => new Response(' '.repeat(2_000_001) + body, { headers }),
    ) as unknown as typeof globalThis.fetch;
    await expect(
      makeDecision({ provider: 'openai', apiKey: 'k' }, { state: 'Ticket', questions: [predicate] }, { fetch }),
    ).rejects.toMatchObject({ code: 'invalid-response' });
  }
});

it('cancels unread error responses and times out a stalled successful body', async () => {
  const request = { state: 'Ticket', questions: [predicate] };
  for (const responseOptions of [{ status: 401 }, { headers: { 'content-length': '2000001' } }]) {
    const canceled = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel: canceled });
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      init?.signal?.addEventListener(
        'abort',
        () => {
          void body.cancel();
        },
        { once: true },
      );
      return new Response(body, responseOptions);
    }) as unknown as typeof globalThis.fetch;
    await expect(makeDecision({ provider: 'jev', apiKey: 'k' }, request, { fetch })).rejects.toBeDefined();
    expect(canceled).toHaveBeenCalledTimes(1);
  }
  vi.useFakeTimers();
  try {
    const canceled = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel: canceled });
    const fetch = vi.fn(async () => new Response(body)) as unknown as typeof globalThis.fetch;
    const result = makeDecision({ provider: 'openai', apiKey: 'k' }, request, { fetch });
    const observed = result.catch(error => error);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await observed).toMatchObject({ code: 'timeout' });
    expect(canceled).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});
