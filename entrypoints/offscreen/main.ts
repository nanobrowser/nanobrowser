// The offscreen document: it does the one thing the worker cannot, turning text into a Blob and a URL for
// chrome.downloads, and revokes the URL when the worker says the download ended. It uses only the runtime API.
const urls = new Set<string>();

chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  if (message?.target !== 'offscreen') return;
  if (message.type === 'blob-url') {
    const url = URL.createObjectURL(new Blob([message.content as string], { type: message.mimeType as string }));
    urls.add(url);
    reply({ url });
  } else if (message.type === 'revoke') {
    URL.revokeObjectURL(message.url as string);
    urls.delete(message.url as string);
    reply({ held: urls.size });
  }
});
