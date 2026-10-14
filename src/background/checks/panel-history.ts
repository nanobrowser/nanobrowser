// History, end to end in the panel page: two conversations, Recent tasks closed while the tab's conversation works,
// search, a row's buttons (Rename, Export as Markdown and Delete), rename, opening a past conversation (shown only: the
// tab, its group and its panel stay), taking it up by sending, a conversation with its own tab opened there, and
// deleting a conversation that is only shown and then the tab's own.
import { defineCheck } from './registry';
import { sleep } from './helpers';
import { openPanelTab, panel, scriptReplies, seedFixtureModel, waitForText } from './panel-chat';

async function waitFor<T>(read: () => Promise<T>, ok: (value: T) => boolean, what: string): Promise<T> {
  const end = Date.now() + 8000;
  let last = await read();
  while (!ok(last) && Date.now() < end) {
    await sleep(150);
    last = await read();
  }
  if (!ok(last)) throw new Error(`${what}: ${JSON.stringify(last)}`);
  return last;
}

/** Records the tabs whose side panel the worker disables while `act` runs. */
async function panelsDisabled(act: () => Promise<void>): Promise<number[]> {
  const setOptions = chrome.sidePanel.setOptions;
  const disabled: number[] = [];
  chrome.sidePanel.setOptions = (options: chrome.sidePanel.PanelOptions) => {
    if (options.enabled === false && options.tabId !== undefined) disabled.push(options.tabId);
    return (setOptions as (options: chrome.sidePanel.PanelOptions) => Promise<void>).call(chrome.sidePanel, options);
  };
  try {
    await act();
  } finally {
    chrome.sidePanel.setOptions = setOptions;
  }
  return disabled;
}

defineCheck({
  name: 'panel-history',
  title: 'Panel history',
  description:
    'Creates conversations, then searches, renames, opens (shown only), takes up, switches to and deletes them through Recent tasks.',
  async run() {
    await seedFixtureModel();
    const tab = await openPanelTab();
    const id = tab.id!;
    let other: number | undefined;
    const read = () => panel(id, 'read');
    const body = async () => (await read()).body;
    const dialog = async () => (await read()).dialog;
    const done = () =>
      waitFor(
        async () => (await read()).status,
        st => st === 'Done',
        'run done',
      );
    const group = async () => (await chrome.tabs.get(id)).groupId;
    try {
      await panel(id, 'type-send', { text: 'First conversation about laptops' });
      await waitForText(id, 'You said: First conversation about laptops');
      // The run ends just after its answer; New chat while it works would ask first.
      await done();
      await panel(id, 'click', { label: 'New chat' });
      await waitFor(body, b => b.includes('How can I help'), 'empty after New chat');

      // Recent tasks stays closed while the tab's conversation works.
      await scriptReplies([{ text: 'You said: Second conversation about tables', delayMs: 2000 }]);
      await panel(id, 'type-send', { text: 'Second conversation about tables' });
      await waitFor(read, r => r.disabled?.includes('History') ?? false, 'History disabled while the run works');
      await waitForText(id, 'You said: Second conversation about tables');
      await done();
      const second = await waitFor(read, r => !r.disabled?.includes('History'), 'History enabled once it stopped');
      const secondTitle = second.title;

      await panel(id, 'click', { label: 'History' });
      await waitFor(dialog, b => b.includes('First conversation') && b.includes('Second conversation'), 'both listed');
      await panel(id, 'fill', { label: 'Search conversations', text: 'laptops' });
      await waitFor(dialog, b => b.includes('First conversation') && !b.includes('Second conversation'), 'search');

      // A row's buttons are Rename, Export as Markdown and Delete; the activity log has no export.
      const labels = (await read()).buttons ?? [];
      const rowButtons = labels.filter(l =>
        ['Rename', 'Export as Markdown', 'Export the activity log', 'Delete'].includes(l ?? ''),
      );
      if (rowButtons.join() !== 'Rename,Export as Markdown,Delete') throw new Error(`a row's buttons: ${rowButtons}`);

      // Rename the first conversation, the only row the search shows.
      await panel(id, 'click', { label: 'Rename' });
      await sleep(200);
      await panel(id, 'fill', { label: 'Rename', text: 'Laptop research', submit: true });
      await panel(id, 'fill', { label: 'Search conversations', text: '' });
      await waitFor(
        dialog,
        b => b.includes('Laptop research') && b.includes('Second conversation about tables'),
        'renamed, search cleared',
      );

      // Open it: the panel shows it, and the tab stays in the second conversation, in its group, with its panel.
      const groupBefore = await group();
      const opening = await panelsDisabled(async () => {
        await panel(id, 'click', { label: 'Laptop research' });
        const opened = await waitForText(id, 'You said: First conversation about laptops');
        if (opened.title !== 'Laptop research') throw new Error(`title after open: ${opened.title}`);
      });
      if (opening.length) throw new Error(`opening a conversation disabled side panels: ${opening}`);
      if ((await group()) !== groupBefore) throw new Error('opening a conversation moved the tab to another group');

      // Sending in it takes it up: the tab moves to its group, and the panel stays enabled.
      const takingUp = await panelsDisabled(async () => {
        await panel(id, 'type-send', { text: 'More about laptops' });
        await waitForText(id, 'You said: More about laptops');
        await done();
      });
      if (takingUp.includes(id)) throw new Error('taking up a conversation disabled the side panel on its tab');
      const groupAfter = await waitFor(group, g => g !== groupBefore && g !== -1, 'the tab joined its group');

      // A conversation with a tab of its own opens there, and this panel keeps what it shows. The panel on that tab
      // shows a past conversation first, and goes back to its own.
      const otherTab = await openPanelTab();
      other = otherTab.id!;
      await panel(other, 'type-send', { text: 'Third conversation in another tab' });
      await waitForText(other, 'You said: Third conversation in another tab');
      await waitFor(
        async () => (await panel(other!, 'read')).status,
        st => st === 'Done',
        'third run done',
      );
      await panel(other, 'click', { label: 'History' });
      await panel(other, 'fill', { label: 'Search conversations', text: 'tables' });
      await waitFor(
        async () => (await panel(other!, 'read')).dialog,
        b => b.includes(secondTitle),
        'second in tab 2',
      );
      await panel(other, 'click', { label: secondTitle });
      await waitForText(other, 'You said: Second conversation about tables');
      await chrome.tabs.update(id, { active: true });
      await panel(id, 'click', { label: 'History' });
      await panel(id, 'fill', { label: 'Search conversations', text: 'Third' });
      await waitFor(dialog, b => b.includes('Third conversation in another tab'), 'the third listed');
      await panel(id, 'click', { label: 'Third conversation in another tab' });
      await waitFor(
        async () => (await chrome.tabs.get(other!)).active,
        a => a,
        'switched to its tab',
      );
      // Its panel, which showed the second conversation, shows the third again.
      await waitForText(other, 'You said: Third conversation in another tab');
      const kept = await read();
      if (!kept.transcript.includes('More about laptops') || kept.transcript.includes('Third conversation'))
        throw new Error(`this panel changed: ${kept.transcript}`);
      await chrome.tabs.update(id, { active: true });

      // Deleting a conversation that is only shown here brings back the tab's own.
      await panel(id, 'click', { label: 'History' });
      await panel(id, 'fill', { label: 'Search conversations', text: 'tables' });
      await waitFor(dialog, b => b.includes(secondTitle), 'the second listed');
      await panel(id, 'click', { label: secondTitle });
      await waitForText(id, 'You said: Second conversation about tables');
      await panel(id, 'click', { label: 'History' });
      await panel(id, 'fill', { label: 'Search conversations', text: 'tables' });
      await waitFor(dialog, b => b.includes(secondTitle), 'the second listed again');
      await panel(id, 'click', { label: 'Delete' });
      await waitFor(dialog, b => b.includes('Cancel'), 'delete asks to confirm');
      await panel(id, 'click', { label: 'Delete' });
      await waitFor(dialog, b => !b.includes(secondTitle), 'the second deleted');
      await panel(id, 'click', { label: 'Close' });
      await waitForText(id, 'You said: More about laptops');
      if ((await group()) !== groupAfter) throw new Error('deleting a shown conversation moved the tab');

      // Delete the conversation this tab belongs to: the panel goes back to an empty chat.
      await panel(id, 'click', { label: 'History' });
      await panel(id, 'fill', { label: 'Search conversations', text: 'Laptop' });
      await waitFor(
        dialog,
        b => b.includes('Laptop research') && !b.includes('Third conversation'),
        'search for the current one',
      );
      const rows = await dialog();
      await panel(id, 'click', { label: 'Delete' });
      await waitFor(dialog, b => b.includes('Cancel'), 'delete asks to confirm');
      await panel(id, 'click', { label: 'Delete' });
      await waitFor(dialog, b => !b.includes('Laptop research'), 'deleted from the list');
      await panel(id, 'fill', { label: 'Search conversations', text: '' });
      await waitFor(dialog, b => b.includes('Third conversation in another tab'), 'the other one stays');
      await panel(id, 'click', { label: 'Close' });
      const after = await waitFor(body, b => b.includes('How can I help'), 'empty after delete');
      return { rows, after };
    } finally {
      await chrome.tabs.remove(id).catch(() => undefined);
      if (other !== undefined) await chrome.tabs.remove(other).catch(() => undefined);
    }
  },
});
