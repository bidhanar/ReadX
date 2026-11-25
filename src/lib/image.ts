/** Largest logo we store (as a data URL in the group doc); the Firestore rules allow up to 150 KB. */
export const MAX_LOGO_CHARS = 140_000;

/**
 * Turn a picked image into a small square logo (centre-cropped), as a data URL. Keeps
 * transparency (WebP, or PNG where the browser can't encode WebP) and falls back to JPEG if
 * that's still too big.
 */
export async function squareLogo(file: File, size = 192): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file (PNG, JPEG, WebP, SVG…).');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("That image couldn't be opened."));
      el.src = url;
    });
    const w = img.naturalWidth || size;
    const h = img.naturalHeight || size;
    const side = Math.min(w, h);
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, (w - side) / 2, (h - side) / 2, side, side, 0, 0, size, size);
    let out = c.toDataURL('image/webp', 0.86);
    if (!out.startsWith('data:image/webp')) out = c.toDataURL('image/png');
    if (out.length > MAX_LOGO_CHARS) {
      // JPEG has no transparency: put it on white first
      const flat = document.createElement('canvas');
      flat.width = flat.height = size;
      const f = flat.getContext('2d')!;
      f.fillStyle = '#ffffff';
      f.fillRect(0, 0, size, size);
      f.drawImage(c, 0, 0);
      out = flat.toDataURL('image/jpeg', 0.8);
    }
    if (out.length > MAX_LOGO_CHARS) throw new Error('That image is too detailed to use as a logo. Try a simpler one.');
    return out;
  } finally {
    URL.revokeObjectURL(url);
  }
}
