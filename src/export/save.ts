import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

/**
 * Android's share sheet often has no "save" target, so Android also offers the
 * system folder picker (Storage Access Framework). iOS's share sheet already
 * has "Save to Files".
 */
export const canSaveToFolder = Platform.OS === 'android';

/** Writes the file to the cache and opens the share sheet (save to Files, mail, ...). */
export async function saveTextFile(name: string, content: string, mimeType: string): Promise<void> {
  const file = new File(Paths.cache, name);
  if (file.exists) file.delete();
  file.create();
  file.write(content);
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.');
  await Sharing.shareAsync(file.uri, { mimeType, dialogTitle: name, UTI: 'public.comma-separated-values-text' });
}

/**
 * Lets the user pick a folder (e.g. Download) and writes the file there.
 * Returns false when the picker was cancelled. An existing file with the same
 * name is kept; Android then adds " (1)" to the new name.
 */
export async function saveToFolder(name: string, content: string, mimeType: string): Promise<boolean> {
  let folder: Directory;
  try {
    folder = await Directory.pickDirectoryAsync();
  } catch (e) {
    // expo-file-system rejects with "The file picker was cancelled by the user".
    const { code, message } = (e ?? {}) as { code?: string; message?: string };
    if (/cancel/i.test(`${code ?? ''} ${message ?? ''}`)) return false;
    throw e;
  }
  const file = folder.createFile(name, mimeType);
  file.write(content);
  return true;
}
