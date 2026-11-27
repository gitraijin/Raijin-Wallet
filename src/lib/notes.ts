import * as SecureStore from './secure-store';
import { onNamespaceChange } from './storage-namespace';

/** Private notes on payments (by payment id), kept on this device. */
const KEY = 'raijin.notes.v1';

let cache: Record<string, string> | null = null;
const listeners = new Set<() => void>();

export async function loadNotes(): Promise<Record<string, string>> {
  if (cache) return cache;
  try {
    cache = JSON.parse((await SecureStore.getItemAsync(KEY)) ?? '{}') as Record<string, string>;
  } catch {
    cache = {};
  }
  return cache;
}

export async function setNote(id: string, note: string): Promise<void> {
  const notes = { ...(await loadNotes()) };
  if (note.trim()) notes[id] = note.trim().slice(0, 500);
  else delete notes[id];
  cache = notes;
  await SecureStore.setItemAsync(KEY, JSON.stringify(notes));
  listeners.forEach((l) => l());
}

export function onNotesChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Drops the in-memory copy (duress switch, backup restore). */
export function forgetNotes(): void {
  cache = null;
}

onNamespaceChange(forgetNotes);
