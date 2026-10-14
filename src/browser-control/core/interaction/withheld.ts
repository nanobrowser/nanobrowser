// Releases that must not take effect. When a sequence stops with a key or a mouse button down, Chrome still needs the
// release, or its input state keeps the key or button down. But a release is what activates (the click of a mouse
// button, Space on a button), and what it would activate now was judged by no one. So the release is sent while a block
// guard in every frame cancels it before any page handler or default action runs.
import type { TabState } from '../controller';

/** The block guard is armed just before the release and removed just after it. */
const BLOCK_MS = 4_000;

/**
 * Sends input the page must not get. Returns false, with nothing sent, when the tab is detached or the block could
 * not be armed in every frame: an unreleased key or button is harmless next to an activation nobody judged.
 */
export async function sendWithheld(
  tab: TabState,
  kind: 'pointer' | 'text',
  send: () => Promise<unknown>,
): Promise<boolean> {
  const { attachment, probe } = tab;
  if (!attachment || !probe) return false;
  const frames = await attachment.topology.frames();
  const armed = await Promise.all(
    frames.map(f =>
      probe.callGlobal(f, 'armBlockGuard', kind, BLOCK_MS).then(
        () => true,
        () => false,
      ),
    ),
  );
  try {
    if (!armed.every(Boolean)) return false;
    await send();
    return true;
  } finally {
    await Promise.all(frames.map(f => probe.callGlobal(f, 'disarm').catch(() => undefined)));
  }
}
