import { desktop } from '@/lib/desktop';

/** Desktop: native "Save as" dialog; browser: download. */
export async function saveTextFile(name: string, content: string, mimeType: string): Promise<void> {
  if (desktop) {
    await desktop.saveFile(name, content);
    return;
  }
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Desktop and browser save directly, so there is no separate folder option. */
export const canSaveToFolder = false;

export async function saveToFolder(name: string, content: string, mimeType: string): Promise<boolean> {
  await saveTextFile(name, content, mimeType);
  return true;
}
