/**
 * Turns the records of an NFC tag (NDEF) into the text Raijin understands:
 * a Lightning invoice, LNURL, Lightning address, bitcoin: link, Cashu token...
 * Pure logic, no native code, so it can be tested with plain Node.
 *
 * Bolt Cards and most payment stickers carry one URI record, e.g.
 * "lnurlw://card.example.com/ln?p=...&c=..." or "lightning:lnbc...".
 */

export type NdefRecordLike = {
  tnf: number;
  /** Android: hex string or bytes; iOS: bytes. */
  type: number[] | string;
  payload: number[];
};

const TNF_WELL_KNOWN = 1;
const TNF_MIME_MEDIA = 2;
const TNF_ABSOLUTE_URI = 3;

/** URI identifier codes from the NFC Forum URI record spec (first payload byte). */
const URI_PREFIXES = [
  '', 'http://www.', 'https://www.', 'http://', 'https://', 'tel:', 'mailto:',
  'ftp://anonymous:anonymous@', 'ftp://ftp.', 'ftps://', 'sftp://', 'smb://', 'nfs://',
  'ftp://', 'dav://', 'news:', 'telnet://', 'imap:', 'rtsp://', 'urn:', 'pop:', 'sip:',
  'sips:', 'tftp:', 'btspp://', 'btl2cap://', 'btgoep://', 'tcpobex://', 'irdaobex://',
  'file://', 'urn:epc:id:', 'urn:epc:tag:', 'urn:epc:pat:', 'urn:epc:raw:', 'urn:epc:',
  'urn:nfc:',
];

function bytes(value: number[] | string): number[] {
  if (Array.isArray(value)) return value;
  // Android reports the record type as a hex string.
  const out: number[] = [];
  for (let i = 0; i + 1 < value.length; i += 2) out.push(parseInt(value.slice(i, i + 2), 16));
  return out;
}

function utf8(data: number[]): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(data));
}

/** UTF-16 by hand (Hermes' TextDecoder may only know UTF-8). BOM picks the byte order, default big-endian. */
function utf16(data: number[]): string {
  let little = false;
  let start = 0;
  if (data[0] === 0xff && data[1] === 0xfe) [little, start] = [true, 2];
  else if (data[0] === 0xfe && data[1] === 0xff) start = 2;
  const units: number[] = [];
  for (let i = start; i + 1 < data.length; i += 2) units.push(little ? data[i] | (data[i + 1] << 8) : (data[i] << 8) | data[i + 1]);
  return String.fromCharCode(...units);
}

/** The text of one record, or null if it is not text-like. */
export function decodeRecord(record: NdefRecordLike): string | null {
  const type = bytes(record.type);
  const payload = record.payload ?? [];
  if (record.tnf === TNF_WELL_KNOWN && type.length === 1 && type[0] === 0x55 && payload.length > 0) {
    // "U": URI record, first byte abbreviates a common prefix.
    return (URI_PREFIXES[payload[0]] ?? '') + utf8(payload.slice(1));
  }
  if (record.tnf === TNF_WELL_KNOWN && type.length === 1 && type[0] === 0x54 && payload.length > 0) {
    // "T": text record, status byte = encoding flag + language code length.
    const status = payload[0];
    const langLength = status & 0x3f;
    const body = payload.slice(1 + langLength);
    return status & 0x80 ? utf16(body) : utf8(body);
  }
  if (record.tnf === TNF_ABSOLUTE_URI) {
    // The URI is the record type itself.
    return utf8(type) || utf8(payload);
  }
  if (record.tnf === TNF_MIME_MEDIA && /^text\//i.test(utf8(type))) {
    return utf8(payload);
  }
  return null;
}

/** All texts on the tag, in record order, trimmed and without empty ones. */
export function textsFromNdef(records: NdefRecordLike[] | undefined | null): string[] {
  return (records ?? [])
    .map(decodeRecord)
    .map((text) => (text ?? '').replace(/\0/g, '').trim())
    .filter(Boolean);
}
