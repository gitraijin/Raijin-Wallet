import { useState } from 'react';
import { View, StyleSheet } from 'react-native';

import { Button, ErrorText, Mono } from '@/components/ui';
import { errorMessage } from '@/lib/format';
import { usePreferences } from '@/preferences/PreferencesContext';
import { makeStyles, space, useTheme } from '@/theme';

import { saveTextFile, saveToFolder } from './save';

export type PendingFile = { name: string; content: string; mimeType: string };

/** Android: a finished file can be saved to a folder on the device or shared. */
export function FileActions({ file, intro }: { file: PendingFile; intro: string }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const { t } = usePreferences();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: 'save' | 'share') => {
    setError(null);
    try {
      if (action === 'share') await saveTextFile(file.name, file.content, file.mimeType);
      else if (await saveToFolder(file.name, file.content, file.mimeType)) setSaved(true);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <View style={styles.block}>
      <Mono style={styles.hint}>{intro}</Mono>
      {saved ? <Mono style={{ color: colors.success }}>{t('file.saved', { name: file.name })}</Mono> : null}
      <ErrorText>{error}</ErrorText>
      <Button label={t('file.saveDevice')} onPress={() => run('save')} />
      <Button label={t('file.share')} variant="ghost" onPress={() => run('share')} />
    </View>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    block: { gap: space.sm },
    hint: { color: colors.textDim, fontSize: 12, lineHeight: 18 },
  }),
);
