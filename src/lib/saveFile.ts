import { ReaderNative, isNative } from './native';

/**
 * Getting a generated file (an export) out of the app, on the web and in the Android app.
 * The Android WebView can't download blobs or use the Web Share API, so the app's native plugin
 * (ReaderPlugin.java) does it there.
 */

export const safeFileName = (name: string) =>
  name
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'ReadX export';

/** Save to the device. Web: browser download. Android: Downloads/ReadX. Returns where it went. */
export async function saveFile(name: string, content: string, mime: string): Promise<string> {
  if (isNative) {
    const { path } = await ReaderNative.saveFile({ name, content, mime });
    return `Saved to ${path}`;
  }
  const url = URL.createObjectURL(new Blob([content], { type: `${mime};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return `Downloaded ${name}`;
}

/** Whether this device can hand a file to other apps (Drive, Notion, email, WhatsApp…). */
export function canShareFiles(): boolean {
  if (isNative) return true;
  try {
    return !!navigator.canShare?.({ files: [new File(['x'], 'x.txt', { type: 'text/plain' })] });
  } catch {
    return false;
  }
}

/** Open the system share sheet with the file. Returns false if the person cancelled. */
export async function shareFile(name: string, content: string, mime: string, title: string): Promise<boolean> {
  try {
    if (isNative) {
      await ReaderNative.shareFile({ name, content, mime, title });
      return true;
    }
    await navigator.share({ title, files: [new File([content], name, { type: mime })] });
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/cancel|abort/i.test(msg)) return false;
    throw e;
  }
}

export async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

/** Web only: open the HTML in a new window and bring up Print (→ "Save as PDF"). */
export function printHtml(html: string): boolean {
  if (isNative) return false;
  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.open();
  w.document.write(html);
  w.document.close();
  const go = () => {
    w.focus();
    w.print();
  };
  if (w.document.readyState === 'complete') setTimeout(go, 150);
  else w.addEventListener('load', go);
  return true;
}
