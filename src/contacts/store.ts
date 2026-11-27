import { getRandomBytes } from 'expo-crypto';

import * as SecureStore from '@/lib/secure-store';

/**
 * Address book: Lightning addresses, LNURLs, bitcoin addresses and node
 * URIs under a name. Kept in the secure store (who you pay is private).
 */
export type Contact = { id: string; name: string; address: string; note?: string; createdAt: number };

const KEY = 'raijin.contacts.v1';

export async function loadContacts(): Promise<Contact[]> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    const list = raw ? (JSON.parse(raw) as Contact[]) : [];
    return Array.isArray(list) ? list.sort((a, b) => a.name.localeCompare(b.name)) : [];
  } catch {
    return [];
  }
}

async function save(list: Contact[]): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(list));
}

export async function addContact(name: string, address: string, note?: string): Promise<Contact> {
  const contact: Contact = {
    id: Array.from(getRandomBytes(8), (b) => b.toString(16).padStart(2, '0')).join(''),
    name: name.trim(),
    address: address.trim(),
    note: note?.trim() || undefined,
    createdAt: Date.now(),
  };
  await save([...(await loadContacts()), contact]);
  return contact;
}

export async function removeContact(id: string): Promise<void> {
  await save((await loadContacts()).filter((c) => c.id !== id));
}

export async function findContact(address: string): Promise<Contact | undefined> {
  const needle = address.trim().toLowerCase();
  return (await loadContacts()).find((c) => c.address.toLowerCase() === needle);
}

export type ContactKind = 'ln-address' | 'lnurl' | 'bitcoin' | 'node' | 'other';

/** What kind of address this is, for the tag in the list. */
export function contactKind(address: string): ContactKind {
  const a = address.trim().toLowerCase();
  if (/^[\w.+-]+@[\w-]+(\.[\w-]+)+$/.test(a)) return 'ln-address';
  if (a.startsWith('lnurl') || a.startsWith('lightning:lnurl')) return 'lnurl';
  if (/^0[23][0-9a-f]{64}/.test(a)) return 'node';
  if (/^(bc1|tb1|bcrt1|[13mn2])[a-z0-9]{20,}$/i.test(a) || a.startsWith('bitcoin:')) return 'bitcoin';
  return 'other';
}

/** Picking a contact from another screen (same pattern as scanInto). */
let pending: ((contact: Contact | null) => void) | null = null;

export function waitForContact(): Promise<Contact | null> {
  pending?.(null);
  return new Promise((resolve) => {
    pending = resolve;
  });
}

export function deliverContact(contact: Contact | null): boolean {
  const resolve = pending;
  pending = null;
  if (!resolve) return false;
  resolve(contact);
  return true;
}
