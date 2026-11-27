import * as DocumentPicker from 'expo-document-picker';

/** Web/desktop: the browser file dialog. */
export async function pickTextFile(): Promise<string | null> {
  const result = await DocumentPicker.getDocumentAsync({ multiple: false });
  const asset = result.canceled ? null : result.assets?.[0];
  if (!asset) return null;
  if (asset.file) return asset.file.text();
  return (await fetch(asset.uri)).text();
}
