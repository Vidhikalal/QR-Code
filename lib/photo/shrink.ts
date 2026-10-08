// Browser only. Vercel caps request bodies at 4.5 MB, so the browser shrinks the photo first (S4
// decision). createImageBitmap applies EXIF orientation; the server still validates and re-processes.
const MAX_SIDE = 2048;

export async function shrinkPhoto(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no canvas');
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), 'image/jpeg', 0.85));
}

export const PHOTO_ERRORS: Record<number, string> = {
  409: "Your photo is locked because you've already checked in.",
  413: 'That photo is too large. Please pick a smaller one.',
  415: "That file isn't a supported image. Please use a JPEG, PNG or WebP photo.",
  429: "You've changed your photo a lot recently. Please try again in an hour.",
};
