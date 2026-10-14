// Scenarios for an element the extension draws over a page while a run works on it: fixed over the whole viewport,
// with pointer-events none, aria-hidden and a closed shadow root. The layer must not see it: not in the outline, not
// in the hit test, and not in the effect evidence, even while it fades in and out.
import type { Result } from '@src/browser-control';
import { FIXTURE_ORIGIN } from '../fixtures-config';
import { evaluate } from '../checks/helpers';
import { defineScenario, outcome } from './registry';
import type { ScenarioContext } from './registry';
import { refOf } from './set-c';

const PAGE = `${FIXTURE_ORIGIN}/d-overlay.html`;

/** The outline's lines without refs, so two snapshots of the same page compare equal. */
const outline = (r: Result) => (r.page?.snapshot ?? '').replace(/\[\w+\]/g, '[]');

async function openWithOverlay(ctx: ScenarioContext): Promise<number> {
  const tabId = await ctx.open(PAGE);
  await evaluate(tabId, undefined, 'window.addOverlay()');
  return tabId;
}

const signals = (r: Result) => r.receipt?.effect.signals.join(' · ') ?? r.error?.code ?? '';

defineScenario({
  id: 'D-overlay-outline',
  set: 'D',
  title: 'An element drawn over the whole page is not in the outline',
  covers: 'the outline is the same with and without the drawn element',
  async run(ctx) {
    const tabId = await ctx.open(PAGE);
    const before = outline(await ctx.call('snapshot'));
    await evaluate(tabId, undefined, 'window.addOverlay()');
    const after = outline(await ctx.call('snapshot'));
    return outcome(
      'the same outline before and after the element is added',
      before === after ? 'same' : `before:\n${before}\nafter:\n${after}`,
      before.length > 0 && before === after,
    );
  },
});

defineScenario({
  id: 'D-overlay-clicks',
  set: 'D',
  title: 'Controls near every edge, under the drawn glow, are clicked',
  covers: 'the hit test passes through an element with pointer-events none; no OBSCURED',
  async run(ctx) {
    const tabId = await openWithOverlay(ctx);
    const results: string[] = [];
    for (const pattern of [/link "Home"/, /button "Account"/, /button "Next"/, /button "Help"/]) {
      const r = await ctx.call('click', {
        target: { ref: refOf(await ctx.call('snapshot'), pattern) },
        timeoutMs: 600,
      });
      results.push(r.ok ? 'ok' : `${r.error?.code}: ${r.error?.message}`);
    }
    const fill = await ctx.call('type', {
      target: { ref: refOf(await ctx.call('snapshot'), /textbox "Search"/) },
      text: 'shoes',
    });
    results.push(fill.ok ? 'ok' : `${fill.error?.code}: ${fill.error?.message}`);
    const clicks = await evaluate<Record<string, number>>(tabId, undefined, 'window.clicks');
    const value = await evaluate<string>(tabId, undefined, 'document.getElementById("search").value');
    return outcome(
      'every click and the typing succeed; each control saw one click; the field holds the text',
      `${results.join(', ')}; clicks ${JSON.stringify(clicks)}; value «${value}»`,
      results.every(r => r === 'ok') &&
        clicks.home === 1 &&
        clicks.account === 1 &&
        clicks.next === 1 &&
        clicks.help === 1 &&
        value === 'shoes',
    );
  },
});

defineScenario({
  id: 'D-overlay-fading',
  set: 'D',
  title: 'The drawn element fades in and out during clicks',
  covers: 'its changes inside the closed shadow root are not effect evidence and do not hold settle',
  async run(ctx) {
    const tabId = await openWithOverlay(ctx);
    await evaluate(tabId, undefined, 'window.fadeFor(4000)');
    const start = performance.now();
    const none = await ctx.call('click', { target: { ref: refOf(await ctx.call('snapshot'), /button "Do nothing"/) } });
    const ms = Math.round(performance.now() - start);
    const toggled = await ctx.call('click', {
      target: { ref: refOf(await ctx.call('snapshot'), /button "Toggle note"/) },
    });
    return outcome(
      '"Do nothing": effect none, settled within about a second; "Toggle note": effect changed with mutations',
      `${none.receipt?.effect.verdict} (${signals(none) || 'no signals'}) in ${ms} ms; ` +
        `${toggled.receipt?.effect.verdict}: ${signals(toggled)}`,
      none.receipt?.effect.verdict === 'none' &&
        ms < 1500 &&
        toggled.receipt?.effect.verdict === 'changed' &&
        /mutation/.test(signals(toggled)),
    );
  },
});
