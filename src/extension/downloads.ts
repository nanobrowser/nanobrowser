// Saving a file the agent made: the offscreen document makes a blob URL, the worker downloads it with chrome.downloads,
// follows the download to its end, then has the URL revoked (at the latest after 10 minutes) and closes the offscreen
// document when it holds none.
const OFFSCREEN = 'offscreen.html';
const held = new Set<string>();

async function ensureOffscreen(): Promise<void> {
  const url = chrome.runtime.getURL(OFFSCREEN);
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [url],
  });
  if (contexts.length) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN,
    reasons: [chrome.offscreen.Reason.BLOBS],
    justification: 'Make blob URLs for files the agent saves',
  });
}

async function revoke(url: string): Promise<void> {
  if (!held.delete(url)) return;
  const answer = (await chrome.runtime.sendMessage({ target: 'offscreen', type: 'revoke', url }).catch(() => null)) as {
    held?: number;
  } | null;
  if (!held.size && (answer?.held ?? 0) === 0) await chrome.offscreen.closeDocument().catch(() => undefined);
}

/** A blob URL for the content, made in the offscreen document. */
export async function blobUrl(content: string, mimeType: string): Promise<string> {
  await ensureOffscreen();
  const answer = (await chrome.runtime.sendMessage({ target: 'offscreen', type: 'blob-url', content, mimeType })) as {
    url: string;
  };
  held.add(answer.url);
  // Revoked anyway after 10 minutes.
  setTimeout(() => void revoke(answer.url), 10 * 60_000);
  return answer.url;
}

export interface SavedFile {
  downloadId: number;
  /** The name the file got in the Downloads folder: a number is added rather than overwrite a file. */
  name: string;
  state: 'complete' | 'interrupted';
  error?: string;
}

/** Waits for a download to complete or be interrupted. */
function follow(downloadId: number): Promise<{ state: 'complete' | 'interrupted'; error?: string }> {
  return new Promise(resolve => {
    const done = (state: 'complete' | 'interrupted', error?: string) => {
      chrome.downloads.onChanged.removeListener(listener);
      resolve({ state, ...(error ? { error } : {}) });
    };
    const listener = (delta: chrome.downloads.DownloadDelta) => {
      if (delta.id !== downloadId || !delta.state?.current) return;
      if (delta.state.current === 'complete') done('complete');
      else if (delta.state.current === 'interrupted') done('interrupted', delta.error?.current);
    };
    chrome.downloads.onChanged.addListener(listener);
    // It may have ended before the listener was added.
    void chrome.downloads.search({ id: downloadId }).then(([item]) => {
      if (item?.state === 'complete') done('complete');
      else if (item?.state === 'interrupted') done('interrupted', item.error);
    });
  });
}

/**
 * Saves text as a file in the Downloads folder. Never overwrites: Chrome adds a number to the name. With `saveAs`,
 * Chrome's own dialog lets the user choose where.
 */
export async function saveText(
  file: { filename: string; content: string; mimeType: string },
  saveAs = false,
): Promise<SavedFile> {
  const url = await blobUrl(file.content, file.mimeType);
  try {
    const downloadId = await chrome.downloads.download({
      url,
      filename: file.filename,
      conflictAction: 'uniquify',
      saveAs,
    });
    const end = await follow(downloadId);
    const [item] = await chrome.downloads.search({ id: downloadId });
    const name = item?.filename ? item.filename.split(/[/\\]/).pop()! : file.filename;
    return { downloadId, name, ...end };
  } finally {
    await revoke(url);
  }
}
