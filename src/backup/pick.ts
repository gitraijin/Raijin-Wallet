import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';

/** Lets the user pick a backup file and returns its text (null if cancelled). */
export async function pickTextFile(): Promise<string | null> {
  const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
  if (result.canceled || !result.assets?.[0]) return null;
  return new File(result.assets[0].uri).text();
}
