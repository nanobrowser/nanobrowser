// "Screenshot of this tab" and screenshot thumbnails: the + menu takes the tab through the layer, the chip shows a
// thumbnail, and the image reaches a vision model after its fixed line; the agent's own screenshot reaches the model
// too, and its row in the activity block shows a thumbnail.
import { FIXTURE_ORIGIN } from '../fixtures-config';
import { defineCheck } from './registry';
import { sleep, waitForLoad } from './helpers';
import { FIXTURE_PROVIDER, panel, scriptReplies, seedFixtureModel, waitForText } from './panel-chat';

defineCheck({
  name: 'panel-screenshot-tab',
  title: 'Screenshot of this tab',
  description: 'The + menu captures the tab as an attachment; the agent’s screenshot gets a thumbnail in its row.',
  async run() {
    await seedFixtureModel();
    await chrome.storage.local.set({
      'nb.providers': [
        {
          ...FIXTURE_PROVIDER,
          models: [{ name: 'fixture-model', overrides: { contextWindow: 32_768, vision: true } }],
        },
      ],
    });
    const page = await chrome.tabs.create({ url: `${FIXTURE_ORIGIN}/c-text.html`, active: false });
    await waitForLoad(page.id!);
    const view = await chrome.tabs.create({
      url: chrome.runtime.getURL(`/sidepanel.html#tab=${page.id}`),
      active: true,
    });
    await waitForLoad(view.id!);
    await sleep(600);
    const id = page.id!;
    try {
      await panel(id, 'click', { label: 'Add' });
      await sleep(100);
      await panel(id, 'click', { label: 'Screenshot of this tab' });
      let read = await panel(id, 'read');
      for (let i = 0; i < 30 && !read.chipImages; i++) {
        await sleep(200);
        read = await panel(id, 'read');
      }
      const chip = { thumbnail: read.chipImages, named: /screenshot-[\d-]+\.png/.test(read.body) };
      await scriptReplies([
        { toolCalls: [{ name: 'screenshot', input: {} }] },
        { text: 'A page with text and form controls.' },
      ]);
      await panel(id, 'type-send', { text: 'What is on this page?' });
      await waitForText(id, 'A page with text and form controls.');
      const requests = (await (await fetch('http://localhost:8787/__llm/requests')).json()) as Array<{
        messages: unknown[];
      }>;
      const first = JSON.stringify(requests.at(-2)?.messages ?? []);
      const second = JSON.stringify(requests.at(-1)?.messages ?? []);
      const steps = (await panel(id, 'read')).transcript.split('\n').find(l => /^Worked for /.test(l.trim()));
      if (steps) await panel(id, 'click', { label: steps.trim() });
      await sleep(200);
      const after = await panel(id, 'read');
      const report = {
        chipThumbnail: (chip.thumbnail ?? 0) > 0,
        chipNamed: chip.named,
        userImageSent: /image_url/.test(first) && first.includes('The following image shows a file the user attached'),
        agentImageSent: /image_url/.test(second) && second.includes('The following image shows a web page'),
        rowThumbnail: (after.activityImages ?? 0) > 0,
        image: await chrome.tabs.captureVisibleTab(view.windowId, { format: 'png' }),
      };
      const failed = Object.entries(report).filter(([, v]) => v === false);
      if (failed.length)
        throw new Error(JSON.stringify({ ...report, image: undefined, body: read.body.slice(0, 600) }));
      return report;
    } finally {
      await chrome.storage.local.set({ 'nb.providers': [FIXTURE_PROVIDER] });
      await chrome.tabs.remove(view.id!).catch(() => undefined);
      await chrome.tabs.remove(page.id!).catch(() => undefined);
    }
  },
});
