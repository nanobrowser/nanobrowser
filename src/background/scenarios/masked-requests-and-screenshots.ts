// Scenarios for the submitter's method, query values in request URLs, sensitive fields in screenshots and sensitive
// listboxes. Each reproduces a reported case and checks it is closed.
import type { AuditEntry, Result, ScreenshotData } from '@src/browser-control';
import { FIXTURE_ORIGIN } from '../fixtures-config';
import { evaluate, sleep } from '../checks/helpers';
import { layer } from '../layer';
import { decline, withUser } from './set-c-confirm';
import type { OpenPrompt } from '../prompts';
import { defineScenario, outcome } from './registry';
import type { ScenarioContext } from './registry';
import { refOf } from './set-c';

const PAGE = `${FIXTURE_ORIGIN}/d-masked-requests-and-screenshots.html`;
const CARDS = ['4111111111111111', '4111 1111 1111 1111', '5555555555554444'];
const CODES = ['246810', '482913', '771045'];

async function openPage(ctx: ScenarioContext): Promise<{ tabId: number; snap: Result }> {
  const tabId = await ctx.open(PAGE);
  return { tabId, snap: await ctx.call('snapshot') };
}

const read = <T>(tabId: number, expression: string) => evaluate<T>(tabId, undefined, expression);
const effects = (tabId: number) => read<string[]>(tabId, 'window.effects');
const prompts = (seen: OpenPrompt[]) =>
  seen.map(p => (p.kind === 'confirm' ? `${p.request.category}: ${p.request.reason}` : p.kind)).join(' | ') || 'none';
const err = (r: Result) => (r.ok ? 'ok' : `${r.error?.code}/${r.error?.delivered}: ${r.error?.message}`);
const leaks = (value: unknown, secrets: string[]) => secrets.filter(s => JSON.stringify(value).includes(s));

defineScenario({
  id: 'L1-formmethod-post-click',
  set: 'C',
  title: 'click "Continue" (formmethod="post") in a GET form with one email field; the scripted user declines',
  covers: 'the search exemption and the basis use the submitter’s method, not the form’s',
  async run(ctx) {
    return withUser(decline, async seen => {
      const { tabId, snap } = await openPage(ctx);
      const r = await ctx.call('click', { target: { ref: refOf(snap, /button "Continue"/) } });
      const e = await effects(tabId);
      return outcome(
        'one prompt for submit naming POST; USER_DECLINED; nothing submitted',
        `${prompts(seen)}; ${err(r)}; effects ${JSON.stringify(e)}`,
        seen.length === 1 && /^submit: .*POST/.test(prompts(seen)) && r.error?.code === 'USER_DECLINED' && !e.length,
      );
    });
  },
});

defineScenario({
  id: 'L1-formmethod-post-enter',
  set: 'C',
  title: 'press Enter in the email field of the same form, whose default button is "Continue" (formmethod="post")',
  covers: 'Enter is judged by the default button’s method',
  async run(ctx) {
    return withUser(decline, async seen => {
      const { tabId, snap } = await openPage(ctx);
      const r = await ctx.call('press', { target: { ref: refOf(snap, /textbox "Email"/) }, keys: 'Enter' });
      const e = await effects(tabId);
      return outcome(
        'one prompt for submit naming POST; USER_DECLINED; nothing submitted',
        `${prompts(seen)}; ${err(r)}; effects ${JSON.stringify(e)}`,
        seen.length === 1 && /^submit: .*POST/.test(prompts(seen)) && r.error?.code === 'USER_DECLINED' && !e.length,
      );
    });
  },
});

defineScenario({
  id: 'L1-request-url-masked',
  set: 'D',
  title: 'set the one-time-code field; its input handler requests /verify?otp=<code>',
  covers: 'request URLs in evidence, and so in the audit, carry no query values',
  async run(ctx) {
    const { controller } = await layer();
    const entries: AuditEntry[] = [];
    const off = controller.onAudit(e => entries.push(e));
    try {
      const { snap } = await openPage(ctx);
      const r = await ctx.call('set', { target: { ref: refOf(snap, /textbox "Verification code"/) }, value: CODES[0] });
      const signals = r.receipt?.effect.signals ?? [];
      return outcome(
        'a request signal for /verify with its query value removed; the code is in neither the result nor the audit',
        `signals ${signals.join('; ')}; leaked in result ${leaks(r, CODES).length}, in audit ${leaks(entries, CODES).length}`,
        signals.some(s => /^request: GET «\/verify\?…» /.test(`${s} `)) &&
          leaks(r, CODES).length === 0 &&
          leaks(entries, CODES).length === 0,
      );
    } finally {
      off();
    }
  },
});

/** How many colours the box (CSS pixels relative to the image, inset by 3 px) holds in the image. */
export async function coloursIn(shot: ScreenshotData, box: { x: number; y: number; width: number; height: number }) {
  const bytes = Uint8Array.from(atob(shot.base64), c => c.charCodeAt(0));
  const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const g = canvas.getContext('2d')!;
  g.drawImage(bitmap, 0, 0);
  const s = shot.scale;
  const x = Math.round((box.x + 3) * s);
  const y = Math.round((box.y + 3) * s);
  const w = Math.max(1, Math.round((box.width - 6) * s));
  const h = Math.max(1, Math.round((box.height - 6) * s));
  const data = g.getImageData(x, y, w, h).data;
  const colours = new Set<number>();
  for (let i = 0; i < data.length; i += 4) colours.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
  return colours.size;
}

export type Box = { x: number; y: number; width: number; height: number };

defineScenario({
  id: 'L1-screenshot-masked',
  set: 'D',
  title: 'screenshots of a page with a filled card number, one in a cross-site frame, and a filled name',
  covers: 'sensitive field values are blanked in every screenshot, cropped and labelled too',
  async run(ctx) {
    const { tabId } = await openPage(ctx);
    await sleep(300);
    const boxes = await read<Record<string, Box>>(
      tabId,
      `(() => {
        const box = el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
        const frame = document.getElementById('pay-frame').getBoundingClientRect();
        return {
          card: box(document.getElementById('cardnum')),
          holder: box(document.getElementById('holder')),
          frameCard: { x: frame.x + 4, y: frame.y + 4, width: 240, height: 28 },
        };
      })()`,
    );
    const view = (await ctx.call('screenshot', {})) as Result<ScreenshotData>;
    const labelled = (await ctx.call('screenshot', { labels: true })) as Result<ScreenshotData>;
    const snap = await ctx.call('snapshot');
    const crop = (await ctx.call('screenshot', {
      ref: refOf(snap, /textbox "Card number"/),
    })) as Result<ScreenshotData>;
    if (!view.data || !labelled.data || !crop.data) {
      return outcome('three screenshots', `${err(view)}; ${err(labelled)}; ${err(crop)}`, false);
    }
    const counts = {
      card: await coloursIn(view.data, boxes.card),
      frameCard: await coloursIn(view.data, boxes.frameCard),
      holder: await coloursIn(view.data, boxes.holder),
      labelledCard: await coloursIn(labelled.data, boxes.card),
      crop: await coloursIn(crop.data, { x: 0, y: 0, width: boxes.card.width, height: boxes.card.height }),
    };
    return outcome(
      'the card fields are one flat colour in every image; the name field still shows its text',
      `colours ${JSON.stringify(counts)}; ${view.text.split('\n').find(l => l.startsWith('screenshot'))}`,
      counts.card === 1 &&
        counts.frameCard === 1 &&
        counts.labelledCard === 1 &&
        counts.crop === 1 &&
        counts.holder > 2,
    );
  },
});

defineScenario({
  id: 'L1-listbox-options-masked',
  set: 'D',
  title: 'snapshot a cc-number listbox whose options are card numbers and a one-time-code listbox of codes',
  covers: 'options of a sensitive listbox are masked in the outline as a sensitive select’s are',
  async run(ctx) {
    const { snap } = await openPage(ctx);
    const found = await ctx.call('find', { role: 'option' });
    return outcome(
      'no card number or code in the snapshot or find; "Visa ending 1111" is printed',
      `leaked ${leaks(snap, [...CARDS, ...CODES]).length} in snapshot, ${leaks(found, [...CARDS, ...CODES]).length} in find; ${
        snap.text.split('\n').filter(l => /option "Visa ending 1111"/.test(l)).length
      } "Visa ending 1111" line`,
      leaks(snap, [...CARDS, ...CODES]).length === 0 &&
        leaks(found, [...CARDS, ...CODES]).length === 0 &&
        /option "Visa ending 1111"/.test(snap.text),
    );
  },
});
