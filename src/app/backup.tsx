import Constants from 'expo-constants';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { type BackupInfo, createBackup, MIN_PASSWORD, openBackup, restoreBackup } from '@/backup/backup';
import { pickTextFile } from '@/backup/pick';
import { Button, ErrorText, Header, InfoRow, Input, Label, Mono, Panel, Screen, Segmented } from '@/components/ui';
import { FileActions, type PendingFile } from '@/export/FileActions';
import { canSaveToFolder, saveTextFile } from '@/export/save';
import { errorMessage, formatTimestamp } from '@/lib/format';
import { goHome } from '@/lib/navigation';
import { ProgressBar } from '@/motion/ProgressBar';
import { usePreferences } from '@/preferences/PreferencesContext';
import { useSecurity } from '@/security/SecurityContext';
import { makeStyles, space, useTheme } from '@/theme';

type Tab = 'create' | 'restore';

/** Encrypted backup of everything (nodes, Cashu, contacts, notes, settings). */
export default function Backup() {
  const { t } = usePreferences();
  const [tab, setTab] = useState<Tab>('create');
  return (
    <Screen scroll>
      <Header title={t('backup.title')} />
      <Segmented<Tab>
        options={[
          { value: 'create', label: t('backup.create') },
          { value: 'restore', label: t('backup.restore') },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'create' ? <Create /> : <Restore />}
    </Screen>
  );
}

function Create() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { t } = usePreferences();
  const security = useSecurity();
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const [file, setFile] = useState<PendingFile | null>(null);
  const [error, setError] = useState<string | null>(null);

  const tooShort = password.length > 0 && password.length < MIN_PASSWORD;
  const mismatch = repeat.length > 0 && repeat !== password;
  const ready = password.length >= MIN_PASSWORD && repeat === password;

  const run = async () => {
    if (!(await security.authenticate(t('backup.create')))) return;
    setError(null);
    setDone(null);
    setFile(null);
    setProgress(0);
    try {
      const { json, entries } = await createBackup(password, Constants.expoConfig?.version ?? '?', (p) =>
        setProgress(p * 100),
      );
      setProgress(null);
      const date = new Date().toISOString().slice(0, 10);
      const name = `raijin-backup-${date}.json`;
      if (canSaveToFolder) setFile({ name, content: json, mimeType: 'application/json' });
      else await saveTextFile(name, json, 'application/json');
      setDone(entries);
      setPassword('');
      setRepeat('');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setProgress(null);
    }
  };

  return (
    <View style={styles.block}>
      <Mono style={styles.hint}>{t('backup.createIntro')}</Mono>
      <Mono style={[styles.hint, { color: colors.accent }]}>{t('backup.passwordWarning')}</Mono>
      <Label>{t('backup.password')}</Label>
      <Input value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" />
      <Label>{t('backup.repeat')}</Label>
      <Input value={repeat} onChangeText={setRepeat} secureTextEntry autoComplete="new-password" />
      {tooShort ? <ErrorText>{t('backup.tooShort', { n: MIN_PASSWORD })}</ErrorText> : null}
      {mismatch ? <ErrorText>{t('backup.mismatch')}</ErrorText> : null}
      {progress !== null ? <ProgressBar progress={progress} label={t('backup.deriving')} /> : null}
      {done !== null && file ? <FileActions file={file} intro={t('backup.ready', { count: done })} /> : null}
      {done !== null && !file ? <Mono style={{ color: colors.success }}>{t('backup.created', { count: done })}</Mono> : null}
      <ErrorText>{error}</ErrorText>
      <Button label={t('backup.createRun')} onPress={run} disabled={!ready} loading={progress !== null} />
    </View>
  );
}

function Restore() {
  const styles = useStyles();
  const { t } = usePreferences();
  const security = useSecurity();
  const [json, setJson] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [opened, setOpened] = useState<{ info: BackupInfo; entries: Record<string, string> } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pick = async () => {
    setError(null);
    setOpened(null);
    try {
      setJson(await pickTextFile());
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const open = async () => {
    if (!json) return;
    setError(null);
    setProgress(0);
    try {
      setOpened(await openBackup(json, password, (p) => setProgress(p * 100)));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setProgress(null);
    }
  };

  const apply = async () => {
    if (!opened || !(await security.authenticate(t('backup.restore')))) return;
    try {
      await restoreBackup(opened.entries);
      goHome();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <View style={styles.block}>
      <Mono style={styles.hint}>{t('backup.restoreIntro')}</Mono>
      <Button label={json ? t('backup.fileChosen') : t('backup.chooseFile')} variant="ghost" onPress={pick} />
      {json && !opened ? (
        <>
          <Label>{t('backup.password')}</Label>
          <Input value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" />
          {progress !== null ? <ProgressBar progress={progress} label={t('backup.deriving')} /> : null}
          <Button label={t('backup.open')} onPress={open} disabled={!password} loading={progress !== null} />
        </>
      ) : null}
      {opened ? (
        <>
          <Panel label={t('backup.contents')}>
            <InfoRow k={t('backup.date')} v={formatTimestamp(Math.floor(Date.parse(opened.info.createdAt) / 1000))} />
            <InfoRow k={t('nodes.title')} v={String(opened.info.nodes)} />
            <InfoRow k={t('cashu.mints')} v={String(opened.info.mints)} />
            <InfoRow k={t('seed.title')} v={opened.info.hasSeed ? t('common.yes') : t('common.no')} />
            <InfoRow k={t('backup.entries')} v={String(opened.info.keys.length)} />
          </Panel>
          <Mono style={styles.hint}>{t('backup.mergeNote')}</Mono>
          <Button label={t('backup.restoreRun')} onPress={apply} />
        </>
      ) : null}
      <ErrorText>{error}</ErrorText>
    </View>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    block: { gap: space.md },
    hint: { color: colors.textDim, fontSize: 12, lineHeight: 18 },
  }),
);
