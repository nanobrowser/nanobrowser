// What can be attached: shared by the panel, which checks a file before writing it to the blob store, and the
// worker, which checks it again before using it.

export const MAX_FILE = 25 * 1024 * 1024;
export const MAX_CONVERSATION = 100 * 1024 * 1024;

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const TEXT_TYPES = new Set([
  'application/json',
  'application/xml',
  'application/javascript',
  'application/x-javascript',
  'application/typescript',
  'application/x-yaml',
  'application/yaml',
  'application/x-sh',
  'application/sql',
]);
const TEXT_EXTENSIONS =
  /\.(txt|md|markdown|csv|tsv|json|jsonl|xml|html?|css|js|jsx|mjs|ts|tsx|py|rb|go|rs|java|kt|c|h|cc|cpp|hpp|cs|php|sh|bash|zsh|yaml|yml|toml|ini|cfg|conf|log|sql|swift|r|lua|pl|scala|vue|svelte)$/i;
const DOCUMENT_EXTENSIONS = /\.(pdf|docx?|xlsx?|pptx?|odt|ods|odp|rtf|pages|numbers|key)$/i;

export type AttachmentKind = 'image' | 'text';

/** What a file is, or why it cannot be attached. */
export function attachmentKind(
  name: string,
  mimeType: string,
): { kind: AttachmentKind } | { refused: string; reason: 'document' | 'type' } {
  if (IMAGE_TYPES.has(mimeType)) return { kind: 'image' };
  if (
    DOCUMENT_EXTENSIONS.test(name) ||
    mimeType === 'application/pdf' ||
    /officedocument|msword|ms-excel|ms-powerpoint|opendocument/.test(mimeType)
  ) {
    return {
      refused: 'PDF and Office files cannot be read in this version. Copy the text into a text file, or paste it.',
      reason: 'document',
    };
  }
  if (mimeType.startsWith('text/') || TEXT_TYPES.has(mimeType) || TEXT_EXTENSIONS.test(name)) return { kind: 'text' };
  return { refused: 'Only images (PNG, JPEG, WebP, GIF) and text files can be attached.', reason: 'type' };
}
