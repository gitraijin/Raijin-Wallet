import { de } from './de';
import { dePlain } from './de-plain';
import { type Dict, en, type TKey } from './en';
import { es } from './es';
import { fr } from './fr';
import { it } from './it';
import { ja } from './ja';
import { pt } from './pt';
import { ru } from './ru';
import { zh } from './zh';

export type { TKey } from './en';

export type Lang = 'en' | 'de' | 'es' | 'fr' | 'it' | 'pt' | 'ja' | 'zh' | 'ru';

/** Languages in picker order, each named in its own language. */
export const LANGUAGES: { code: Lang; name: string }[] = [
  { code: 'en', name: 'English' },
  { code: 'de', name: 'Deutsch' },
  { code: 'es', name: 'Español' },
  { code: 'fr', name: 'Français' },
  { code: 'it', name: 'Italiano' },
  { code: 'pt', name: 'Português' },
  { code: 'ja', name: '日本語' },
  { code: 'zh', name: '简体中文' },
  { code: 'ru', name: 'Русский' },
];

const dictionaries: Record<Lang, Dict> = { en, de, es, fr, it, pt, ja, zh, ru };

export function isLang(value: unknown): value is Lang {
  return typeof value === 'string' && value in dictionaries;
}

/** Device language if supported, otherwise English. */
export function resolveLang(preference: Lang | 'auto', deviceLanguage: string | null): Lang {
  if (preference !== 'auto') return preference;
  return isLang(deviceLanguage) ? deviceLanguage : 'en';
}

export type TParams = Record<string, string | number>;
export type Translate = (key: TKey, params?: TParams) => string;

/**
 * Fujin style: turns Raijin's terminal texts into plain sentences.
 * "> no channels yet.\n> open one …" → "No channels yet. Open one …",
 * "[+] your node" → "• Your node", "a // b" → "a · b".
 */
export function plainText(text: string): string {
  const cap = (s: string) => s.charAt(0).toLocaleUpperCase() + s.slice(1);
  const lines = text
    .split('\n')
    .map((line) =>
      line
        .replace(/^> ?/, '')
        .replace(/^\[\+\] /, '• ')
        .replace(/^\/\/ /, '')
        .replace(/ \/\/ /g, ' · ')
        .trim(),
    )
    .filter(Boolean);
  return lines.map((l) => (l.startsWith('• ') ? '• ' + cap(l.slice(2)) : cap(l))).join(' ');
}

export function translator(lang: Lang, plain = false): Translate {
  const dict = dictionaries[lang];
  return (key, params) => {
    const raw = dict[key] ?? en[key];
    // German terminal texts are all lower case: the Fujin style uses properly cased ones.
    const text = plain ? ((lang === 'de' ? dePlain[key] : undefined) ?? plainText(raw)) : raw;
    if (!params) return text;
    return text.replace(/\{(\w+)\}/g, (match, name: string) =>
      name in params ? String(params[name]) : match,
    );
  };
}
