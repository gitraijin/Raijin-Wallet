import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import {
  addContact,
  type Contact,
  contactKind,
  type ContactKind,
  deliverContact,
  loadContacts,
  removeContact,
} from '@/contacts/store';
import { Button, ErrorText, Header, Input, Label, Mono, Panel, Screen } from '@/components/ui';
import { truncateMiddle } from '@/lib/format';
import { scanInto } from '@/lib/scan-result';
import { useT } from '@/preferences/PreferencesContext';
import { fonts, makeStyles, space, useTheme } from '@/theme';
import { confirmAction } from '@/lib/confirm';

const KIND_TAG: Record<ContactKind, string> = {
  'ln-address': 'LN@',
  lnurl: 'LNURL',
  bitcoin: '₿',
  node: 'NODE',
  other: '?',
};

/** Address book. With ?pick=1 a tap hands the contact back to the calling screen. */
export default function Contacts() {
  const styles = useStyles();
  const { colors } = useTheme();
  const t = useT();
  const { pick, address: prefill } = useLocalSearchParams<{ pick?: string; address?: string }>();
  const picking = pick === '1';
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(Boolean(prefill));
  const [name, setName] = useState('');
  const [address, setAddress] = useState(prefill ?? '');
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    loadContacts().then(setContacts, () => {});
  }, []);
  useFocusEffect(reload);

  // Leaving the picker without a choice releases the waiting screen.
  useEffect(
    () => () => {
      if (picking) deliverContact(null);
    },
    [picking],
  );

  const save = async () => {
    if (!name.trim() || !address.trim()) {
      setError(t('contacts.missing'));
      return;
    }
    await addContact(name, address);
    setName('');
    setAddress('');
    setAdding(false);
    setError(null);
    reload();
  };

  const open = (contact: Contact) => {
    if (picking) {
      deliverContact(contact);
      router.back();
      return;
    }
    if (contactKind(contact.address) === 'node') {
      router.push({ pathname: '/channel-open', params: { node: contact.address } });
    } else {
      router.push({ pathname: '/send', params: { value: contact.address } });
    }
  };

  const remove = async (contact: Contact) => {
    if (!(await confirmAction(t('contacts.removeTitle', { name: contact.name }), undefined, t('contacts.remove'), t('common.cancel')))) return;
    await removeContact(contact.id);
    reload();
  };

  const q = query.trim().toLowerCase();
  const shown = q ? contacts.filter((c) => `${c.name} ${c.address}`.toLowerCase().includes(q)) : contacts;

  return (
    <Screen scroll>
      <Header title={t('contacts.title')} />
      {adding ? (
        <Panel label={t('contacts.add')}>
          <Label>{t('contacts.name')}</Label>
          <Input value={name} onChangeText={setName} placeholder="Alice" autoCapitalize="words" maxLength={60} />
          <Label>{t('contacts.address')}</Label>
          <Input value={address} onChangeText={setAddress} placeholder="alice@getalby.com" multiline />
          <Button
            label={t('scan.button')}
            variant="ghost"
            onPress={async () => {
              const scanned = await scanInto();
              if (scanned) setAddress(scanned);
            }}
          />
          <ErrorText>{error}</ErrorText>
          <Button label={t('contacts.save')} onPress={save} />
          <Button label={t('common.cancel')} variant="ghost" onPress={() => setAdding(false)} />
        </Panel>
      ) : (
        <Button label={t('contacts.add')} variant="secondary" onPress={() => setAdding(true)} />
      )}

      {contacts.length > 5 ? (
        <Input value={query} onChangeText={setQuery} placeholder={t('contacts.search')} />
      ) : null}

      {shown.length === 0 ? <Mono style={styles.empty}>{t('contacts.empty')}</Mono> : null}
      {shown.map((contact) => (
        <Pressable
          key={contact.id}
          onPress={() => open(contact)}
          onLongPress={() => remove(contact)}
          accessibilityRole="button"
          accessibilityHint={t('contacts.longPress')}
          style={styles.row}>
          <View style={styles.left}>
            <Mono style={styles.name}>{contact.name}</Mono>
            <Mono style={styles.address} numberOfLines={1}>
              {truncateMiddle(contact.address, 18)}
            </Mono>
          </View>
          <Mono style={[styles.tag, { color: colors.accent, borderColor: colors.accent }]}>
            {KIND_TAG[contactKind(contact.address)]}
          </Mono>
        </Pressable>
      ))}
      {shown.length > 0 ? <Mono style={styles.empty}>{t('contacts.longPress')}</Mono> : null}
    </Screen>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    empty: { color: colors.textFaint, fontSize: 12 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: space.md,
      paddingVertical: space.sm,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    left: { flexShrink: 1, gap: 2 },
    name: { fontFamily: fonts.bold, fontSize: 14 },
    address: { fontSize: 11, color: colors.textDim },
    tag: { fontFamily: fonts.medium, fontSize: 10, borderWidth: 1, paddingHorizontal: 6, paddingVertical: 2 },
  }),
);
