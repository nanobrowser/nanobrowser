// Small JPEG thumbnails of screenshots, made in the worker with OffscreenCanvas: beside a screenshot row of the
// activity block, and on the chip of a "Screenshot of this tab".
export async function thumbnail(base64: string, mimeType: string, max = 240): Promise<string | undefined> {
  if (typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') return undefined;
  try {
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: mimeType }));
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(width, height);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.7 });
    const out = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let i = 0; i < out.length; i += 0x8000) binary += String.fromCharCode(...out.subarray(i, i + 0x8000));
    return `data:image/jpeg;base64,${btoa(binary)}`;
  } catch {
    return undefined;
  }
}
