import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDecisionEngine, NoopDecisionEngine } from '../engine';
import { DecisionError } from '../errors';
import { JevDecisionEngine, JEV_ENDPOINT } from '../jev';
import { sanitizeDecisionInput } from '../policy';
import { DEFAULT_DECISION_CONFIG, type DecisionContext } from '../types';

const context: DecisionContext = {
  taskId: 'task-1',
  task: 'Find the support address.',
  browser: { url: 'https://example.com/contact', title: 'Contact', pageText: 'Support: support@example.com' },
  outcomes: [{ extractedContent: 'The contact page loaded.' }],
};
const action = { name: 'click_element', parameters: { index: 4 } };
const config = { ...DEFAULT_DECISION_CONFIG, enabled: true, apiKey: 'fixture-key' };

function choice(choice: string, options: string[], confidence = 0.95, selectedProbability = 0.96) {
  return {
    type: 'choice',
    choice,
    confidence,
    probabilities: Object.fromEntries(
      options.map(option => [
        option,
        option === choice ? selectedProbability : (1 - selectedProbability) / (options.length - 1),
      ]),
    ),
  };
}

function response(answers: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify({ model: 'jev-test', answers, usage: { input_tokens: 200, output_tokens: 20 } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function actionResponse(outcome = 'proceed', confidence = 0.95, selectedProbability = 0.96) {
  return response({ action: choice(outcome, ['proceed', 'reconsider', 'confirm'], confidence, selectedProbability) });
}

function completionResponse(outcome: string, handoff = 0.02, confidence = 0.95) {
  return response({
    completion: choice(outcome, ['complete', 'incomplete', 'needs_verification'], confidence),
    handoff: { type: 'noul', noul: handoff },
  });
}

afterEach(() => vi.useRealTimers());

describe('Decision engine compatibility', () => {
  it('uses a no-op without requiring credentials when disabled', async () => {
    const fetch = vi.fn();
    const engine = createDecisionEngine(DEFAULT_DECISION_CONFIG, { fetch });
    expect(engine).toBeInstanceOf(NoopDecisionEngine);
    expect((await engine.evaluateAction(context, action)).outcome).toBe('proceed');
    expect(await engine.verifyCompletion(context)).toMatchObject({ outcome: 'complete', isHandoff: false });
    expect((await engine.selectAction(context, [])).outcome).toBe('fallback');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects invalid enabled configuration without leaking its key', () => {
    expect(() => new JevDecisionEngine({ ...config, apiKey: 'a-secret\nkey' })).toThrow(DecisionError);
    expect(() => new JevDecisionEngine({ ...config, completionThreshold: 1.1 })).toThrow('Check your settings');
  });
});

describe('Jev action evaluation', () => {
  it.each(['proceed', 'reconsider', 'confirm'])('returns %s through the documented typed API', async outcome => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(actionResponse(outcome));
    const decision = await new JevDecisionEngine(config, { fetch }).evaluateAction(context, action);
    expect(decision).toMatchObject({ outcome, confidence: 0.95, probability: 0.96 });
    expect(decision.metadata).toMatchObject({ apiCalls: 1, usage: { inputTokens: 200, outputTokens: 20 } });
    expect(decision.metadata.estimatedCost).toBeUndefined();
    const [endpoint, options] = fetch.mock.calls[0];
    expect(endpoint).toBe(JEV_ENDPOINT);
    expect(options).toMatchObject({ method: 'POST', credentials: 'omit', redirect: 'error' });
    expect(options?.headers).toEqual({ Authorization: 'Bearer fixture-key', 'Content-Type': 'application/json' });
    const request = JSON.parse(options?.body as string);
    expect(request).toMatchObject({ model: 'jev-latest', state: { task: context.task, action } });
    expect(request.questions.action).toMatchObject({ type: 'choice' });
    expect(Object.keys(request.questions.action.criteria)).toEqual(['proceed', 'reconsider', 'confirm']);
    expect(request.state.taskId).toBeUndefined();
  });

  it.each([
    [0.4, 0.96],
    [0.95, 0.6],
  ])('reconsiders when confidence %s or selected probability %s is below threshold', async (confidence, selected) => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(actionResponse('proceed', confidence, selected));
    expect(await new JevDecisionEngine(config, { fetch }).evaluateAction(context, action)).toMatchObject({
      outcome: 'reconsider',
      reasonCode: 'low_confidence',
    });
  });

  it('never approves merely because explicit confirmation has low confidence', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(actionResponse('confirm', 0.4, 0.5));
    expect((await new JevDecisionEngine(config, { fetch }).evaluateAction(context, action)).outcome).toBe('confirm');
  });

  it('only estimates cost when prices were explicitly configured', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(actionResponse());
    const engine = new JevDecisionEngine({ ...config, inputCostPerMillion: 2, outputCostPerMillion: 4 }, { fetch });
    expect((await engine.evaluateAction(context, action)).metadata.estimatedCost).toBeCloseTo(0.00048);
  });
});

describe('Jev completion verification', () => {
  it.each(['complete', 'incomplete', 'needs_verification'])('evaluates %s', async outcome => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(completionResponse(outcome));
    expect(await new JevDecisionEngine(config, { fetch }).verifyCompletion(context)).toMatchObject({
      outcome,
      isHandoff: false,
    });
  });

  it('cannot accept weak completion confidence', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(completionResponse('complete', 0.01, 0.85));
    expect((await new JevDecisionEngine(config, { fetch }).verifyCompletion(context)).outcome).toBe(
      'needs_verification',
    );
  });

  it('distinguishes blocked handoff from completion using an atomic question', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(completionResponse('complete', 0.94));
    const blocked = { ...context, claimedCompletion: { success: false, text: 'Please log in to continue.' } };
    expect(await new JevDecisionEngine(config, { fetch }).verifyCompletion(blocked)).toMatchObject({
      outcome: 'needs_verification',
      isHandoff: true,
      reasonCode: 'handoff',
    });
    const request = JSON.parse(fetch.mock.calls[0][1]?.body as string);
    expect(request.questions.handoff.type).toBe('noul');
    expect(request.state.claimedCompletion.success).toBe(false);
  });
});

describe('Jev routing and bounded action selection', () => {
  it.each(['fast', 'capable', 'planner', 'confirm'])('routes to %s', async outcome => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(response({ route: choice(outcome, ['fast', 'capable', 'planner', 'confirm']) }));
    expect((await new JevDecisionEngine(config, { fetch }).routeTask(context)).outcome).toBe(outcome);
  });

  it('escalates uncertain routing to the Planner', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(response({ route: choice('fast', ['fast', 'capable', 'planner', 'confirm'], 0.4) }));
    expect((await new JevDecisionEngine(config, { fetch }).routeTask(context)).outcome).toBe('planner');
  });

  it('selects a supplied candidate ID, with generative and low-confidence fallbacks', async () => {
    const candidates = [{ id: 'click-4', action, label: 'Contact link' }];
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response({ selection: choice('click-4', ['click-4', '__fallback__']) }))
      .mockResolvedValueOnce(response({ selection: choice('__fallback__', ['click-4', '__fallback__']) }))
      .mockResolvedValueOnce(response({ selection: choice('click-4', ['click-4', '__fallback__'], 0.5) }));
    const engine = new JevDecisionEngine(config, { fetch });
    expect(await engine.selectAction(context, candidates)).toMatchObject({
      outcome: 'selected',
      candidateId: 'click-4',
    });
    expect(await engine.selectAction(context, candidates)).toMatchObject({ outcome: 'fallback' });
    expect(await engine.selectAction(context, candidates)).not.toHaveProperty('candidateId');
  });

  it('skips empty candidates and rejects duplicate or reserved IDs', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const engine = new JevDecisionEngine(config, { fetch });
    expect((await engine.selectAction(context, [])).reasonCode).toBe('no_candidates');
    await expect(engine.selectAction(context, [{ id: '__fallback__', action }])).rejects.toMatchObject({
      code: 'configuration',
    });
    await expect(
      engine.selectAction(context, [
        { id: 'a', action },
        { id: 'a', action },
      ]),
    ).rejects.toMatchObject({ code: 'configuration' });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('Jev API failure boundaries', () => {
  it.each([401, 403, 400, 422])('does not retry terminal status %s or expose raw bodies', async status => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response('password=server-secret', { status }));
    const promise = new JevDecisionEngine(config, { fetch }).evaluateAction(context, action);
    await expect(promise).rejects.toMatchObject({
      code: status === 401 || status === 403 ? 'authentication' : 'configuration',
      status,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    await expect(promise).rejects.not.toThrow('server-secret');
  });

  it.each([429, 529, 503])('retries transient status %s within one budget', async status => {
    vi.useFakeTimers();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response('', { status }))
      .mockResolvedValueOnce(new Response('', { status }))
      .mockResolvedValueOnce(actionResponse());
    const promise = new JevDecisionEngine(config, { fetch }).evaluateAction(context, action);
    await vi.advanceTimersByTimeAsync(750);
    expect((await promise).metadata.apiCalls).toBe(3);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('fails after two network retries and masks network error text', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error('token=network-secret'));
    const promise = new JevDecisionEngine(config, { fetch }).evaluateAction(context, action);
    const assertion = expect(promise).rejects.toMatchObject({ code: 'network' });
    await vi.advanceTimersByTimeAsync(750);
    await assertion;
    expect(fetch).toHaveBeenCalledTimes(3);
    await expect(promise).rejects.not.toThrow('network-secret');
  });

  it('bounds a transport that ignores abort to the total timeout', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn<typeof globalThis.fetch>().mockReturnValue(new Promise(() => {}));
    const promise = new JevDecisionEngine({ ...config, timeoutMs: 1_000 }, { fetch }).evaluateAction(context, action);
    const assertion = expect(promise).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(1_000);
    await assertion;
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });

  it('cancels in-flight decisions immediately without retry', async () => {
    const controller = new AbortController();
    const fetch = vi.fn<typeof globalThis.fetch>().mockReturnValue(new Promise(() => {}));
    const promise = new JevDecisionEngine(config, { fetch }).evaluateAction(
      { ...context, signal: controller.signal },
      action,
    );
    const assertion = expect(promise).rejects.toMatchObject({ code: 'cancelled' });
    controller.abort();
    await assertion;
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not call the API after cancellation', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetch = vi.fn<typeof globalThis.fetch>();
    await expect(
      new JevDecisionEngine(config, { fetch }).evaluateAction({ ...context, signal: controller.signal }, action),
    ).rejects.toMatchObject({ code: 'cancelled' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not retry a transport AbortError even if its injected signal was not aborted', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new DOMException('private details', 'AbortError'));
    await expect(new JevDecisionEngine(config, { fetch }).evaluateAction(context, action)).rejects.toMatchObject({
      code: 'cancelled',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('includes body decoding and retry backoff in the same total deadline', async () => {
    vi.useFakeTimers();
    const slowBody = new Response(new ReadableStream<Uint8Array>());

    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response('', { status: 429 }))
      .mockResolvedValueOnce(slowBody);
    const promise = new JevDecisionEngine({ ...config, timeoutMs: 500 }, { fetch }).evaluateAction(context, action);
    const assertion = expect(promise).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(500);
    await assertion;
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not retry invalid JSON or missing usage', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response('{invalid'))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            model: 'jev-test',
            answers: { action: choice('proceed', ['proceed', 'reconsider', 'confirm']) },
          }),
        ),
      );
    const engine = new JevDecisionEngine(config, { fetch });
    await expect(engine.evaluateAction(context, action)).rejects.toMatchObject({ code: 'response' });
    await expect(engine.evaluateAction(context, action)).rejects.toMatchObject({ code: 'response' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    {
      type: 'choice',
      choice: 'invented',
      probabilities: { proceed: 0.96, reconsider: 0.04, confirm: 0 },
      confidence: 0.95,
    },
    { type: 'choice', choice: 'proceed', probabilities: { proceed: 2, reconsider: 0, confirm: 0 }, confidence: 0.95 },
    { type: 'choice', choice: 'proceed', probabilities: { proceed: 0.7, reconsider: 0, confirm: 0 }, confidence: 0.95 },
    {
      type: 'choice',
      choice: 'proceed',
      probabilities: { proceed: 0.1, reconsider: 0.9, confirm: 0 },
      confidence: 0.95,
    },
    { type: 'noul', noul: 0.95 },
  ])('rejects malformed or inconsistent answers without retry', async answer => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response({ action: answer }));
    await expect(new JevDecisionEngine(config, { fetch }).evaluateAction(context, action)).rejects.toMatchObject({
      code: 'response',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('Jev privacy filtering', () => {
  it('redacts credentials, identifiers and URL queries in all transmitted state', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(actionResponse());
    const engine = new JevDecisionEngine(config, { fetch });
    await engine.evaluateAction(
      {
        ...context,
        task: 'Use password=ordinary-secret and card 4111 1111 1111 1111. SSN 123-45-6789.',
        browser: {
          url: 'https://name:pass@example.com/?access_token=hidden#fragment',
          pageText: 'Authorization: Bearer abcdef\n[input type=password value=hidden-password]',
        },
        outcomes: [
          {
            cookie: 'private-cookie',
            details: 'https://example.com/?api_key=query-secret',
            headers: 'Cookie: session=one-cookie; csrf=another-cookie',
          },
        ],
      },
      { name: 'input_text', parameters: { type: 'password', text: 'private-input', accessToken: 'private-token' } },
    );
    const body = fetch.mock.calls[0][1]?.body as string;
    for (const secret of [
      'ordinary-secret',
      '4111',
      '123-45-6789',
      'private-cookie',
      'hidden-password',
      'private-input',
      'private-token',
      'hidden',
      'fragment',
      'query-secret',
      'one-cookie',
      'another-cookie',
      'abcdef',
      'name:pass',
    ]) {
      expect(body).not.toContain(secret);
    }
    expect(body).not.toContain(config.apiKey);
    expect(JSON.parse(body).state.browser.url).toBe('https://example.com/');
  });

  it('bounds text, recursion and cycles while retaining useful task evidence', () => {
    const input: Record<string, unknown> = {
      task: 'Find contact details',
      page: 'x'.repeat(50_000),
      href: '/reset?token=secret',
    };
    input.self = input;
    const clean = sanitizeDecisionInput(input) as Record<string, unknown>;
    expect(clean.task).toBe('Find contact details');
    expect((clean.page as string).length).toBe(8_000);
    expect(clean.href).toBe('/reset');
    expect(clean.self).toBe('[CIRCULAR]');
  });
});
it('preserves the original execution path and never requests credentials when disabled', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>();
  const engine = createDecisionEngine(DEFAULT_DECISION_CONFIG, { fetch });
  const context = { taskId: 'offline-task', task: 'Find the support address.' };
  expect(engine).toBeInstanceOf(NoopDecisionEngine);
  expect((await engine.evaluateAction(context, { name: 'click', parameters: { ref: '1' } })).outcome).toBe('proceed');
  expect(await engine.verifyCompletion(context)).toMatchObject({ outcome: 'complete', isHandoff: false });
  expect((await engine.routeTask(context)).outcome).toBe('planner');
  expect((await engine.selectAction(context, [])).outcome).toBe('fallback');
  expect(fetch).not.toHaveBeenCalled();
});

it('requires exact answer names and a nonempty model before using the decision', async () => {
  const valid = {
    model: 'jev-test',
    answers: { action: choice('proceed', ['proceed', 'reconsider', 'confirm']) },
    usage: { input_tokens: 200, output_tokens: 20 },
  };
  for (const raw of [
    { ...valid, answers: { ...valid.answers, other: { type: 'noul', noul: 1 } } },
    { ...valid, model: '' },
    { ...valid, answers: { other: valid.answers.action } },
  ]) {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(JSON.stringify(raw)));
    await expect(new JevDecisionEngine(config, { fetch }).evaluateAction(context, action)).rejects.toMatchObject({
      code: 'response',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  }
});

it('rejects oversized declared and streamed response bodies without retry', async () => {
  const valid = JSON.stringify({
    model: 'jev-test',
    answers: { action: choice('proceed', ['proceed', 'reconsider', 'confirm']) },
    usage: { input_tokens: 200, output_tokens: 20 },
  });
  for (const body of [
    new Response(valid, { headers: { 'content-length': '2000001' } }),
    new Response(' '.repeat(2_000_001) + valid),
  ]) {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(body);
    await expect(new JevDecisionEngine(config, { fetch }).evaluateAction(context, action)).rejects.toMatchObject({
      code: 'response',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  }
});

it('cancels unread error bodies before terminal failures and transient retries', async () => {
  for (const options of [{ status: 401 }, { headers: { 'content-length': '2000001' } }]) {
    const canceled = vi.fn();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(new ReadableStream({ cancel: canceled }), options));
    await expect(new JevDecisionEngine(config, { fetch }).evaluateAction(context, action)).rejects.toBeInstanceOf(
      DecisionError,
    );
    expect(canceled).toHaveBeenCalledTimes(1);
  }
  vi.useFakeTimers();
  const canceled = vi.fn();
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(new Response(new ReadableStream({ cancel: canceled }), { status: 503 }))
    .mockResolvedValueOnce(actionResponse());
  const promise = new JevDecisionEngine(config, { fetch }).evaluateAction(context, action);
  await vi.advanceTimersByTimeAsync(250);
  expect((await promise).metadata.apiCalls).toBe(2);
  expect(canceled).toHaveBeenCalledTimes(1);
});

it('redacts ordinary form values from v0.3 page outlines while preserving labels and refs', async () => {
  const pageText = [
    '[e1] textbox "Full name" (required) = "ordinary-private-name"',
    '[e2] searchbox "Search" = "ordinary-private-query"',
    '[e3] combobox "Status" (collapsed) = "ordinary-private-status"',
    '[e4] spinbutton "Amount" = "2468"',
    '[e5] slider "Limit" = "1357"',
    '[e6] textarea "Note" value="ordinary-private-note"',
    '[e7] textbox "Quote" = "escaped \\"ordinary-private-quote\\""',
    '[e8] button "Save"',
    'text "Visible catalogue information"',
  ].join('\n');
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(actionResponse());
  await new JevDecisionEngine(config, { fetch }).evaluateAction(
    { ...context, browser: { ...context.browser!, pageText } },
    action,
  );
  const sent = JSON.parse(fetch.mock.calls[0][1]?.body as string).state.browser.pageText as string;
  for (const value of [
    'ordinary-private-name',
    'ordinary-private-query',
    'ordinary-private-status',
    '2468',
    '1357',
    'ordinary-private-note',
    'ordinary-private-quote',
  ]) {
    expect(sent).not.toContain(value);
  }
  expect(sent).toContain('[e1] textbox "Full name" (required) = "[REDACTED]"');
  expect(sent).toContain('[e8] button "Save"');
  expect(sent).toContain('Visible catalogue information');
});
