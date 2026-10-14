// A write card in the panel, end to end: the fake model asks to click "Send" on a fixture page, the layer classifies
// it, the PromptBroker routes the card to the conversation's panel, the user allows it there, and the run finishes.
import { FIXTURE_ORIGIN } from '../fixtures-config';
import { defineCheck } from './registry';
import { sleep, waitForLoad } from './helpers';
import { panel, scriptReplies, seedFixtureModel, waitForText } from './panel-chat';

defineCheck({
  name: 'panel-cards',
  title: 'Write card in the panel',
  description:
    'Runs the agent with the fake model on g-writes.html; the write card opens in the panel and is answered there.',
  async run() {
    await seedFixtureModel();
    await scriptReplies([
      {
        toolCalls: [
          { name: 'click', input: { target: { role: 'button', name: 'Send' }, intent: 'Send the reply to Dana' } },
        ],
      },
      // The form's handler changes nothing on screen, so the click leaves debt: a read clears it.
      { toolCalls: [{ name: 'snapshot', input: {} }] },
      { toolCalls: [{ name: 'done', input: { outcome: 'success', summary: 'The reply was sent.' } }] },
    ]);
    const page = await chrome.tabs.create({ url: `${FIXTURE_ORIGIN}/g-writes.html`, active: false });
    await waitForLoad(page.id!);
    const tab = await chrome.tabs.create({
      url: chrome.runtime.getURL(`/sidepanel.html#tab=${page.id}`),
      active: true,
    });
    await waitForLoad(tab.id!);
    await sleep(600);
    try {
      await panel(page.id!, 'type-send', { text: 'Send the reply' });
      let body = '';
      for (let i = 0; i < 50 && !body.includes('Send this?'); i++) {
        await sleep(200);
        body = (await panel(page.id!, 'read')).body;
      }
      if (!body.includes('Send this?')) throw new Error(`no write card:\n${body}`);
      const image = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
      await panel(page.id!, 'click', { label: 'Allow' });
      const end = await waitForText(page.id!, 'The reply was sent.');
      return {
        card: body.split('\n').filter(l => /Send this|on localhost|purpose|Asked/.test(l)),
        transcript: end.transcript,
        image,
      };
    } finally {
      await chrome.tabs.remove(tab.id!).catch(() => undefined);
      await chrome.tabs.remove(page.id!).catch(() => undefined);
    }
  },
});
