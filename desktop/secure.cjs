'use strict';
/**
 * Secure key/value store of the desktop app (the counterpart of
 * expo-secure-store). Values are encrypted with Electron safeStorage, which
 * uses the OS keychain: Keychain on macOS, DPAPI on Windows, libsecret or
 * kwallet on Linux. Only ciphertext is written to disk.
 */
const fs = require('node:fs');
const path = require('node:path');
const { safeStorage } = require('electron');

class SecureStore {
  constructor(file) {
    this.file = file;
    this.data = null;
    this.loading = null;
    this.writing = Promise.resolve();
  }

  load() {
    if (!this.loading) this.loading = this.read();
    return this.loading;
  }

  async read() {
    if (!(await safeStorage.isAsyncEncryptionAvailable())) {
      throw new Error('The system keychain is not available, so secrets cannot be stored safely.');
    }
    if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text') {
      console.warn('[secure] no libsecret/kwallet found: secrets are only obfuscated on this system');
    }
    try {
      this.data = JSON.parse(await fs.promises.readFile(this.file, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') console.error('[secure] cannot read store', error);
      this.data = {};
    }
    return this.data;
  }

  async get(key) {
    const data = await this.load();
    const value = data[key];
    if (typeof value !== 'string') return null;
    const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(Buffer.from(value, 'base64'));
    // The keychain key was rotated: store it again under the new key.
    if (shouldReEncrypt) await this.set(key, result);
    return result;
  }

  async set(key, value) {
    const data = await this.load();
    data[key] = (await safeStorage.encryptStringAsync(String(value))).toString('base64');
    return this.persist();
  }

  async delete(key) {
    const data = await this.load();
    delete data[key];
    return this.persist();
  }

  /** Writes atomically (temp file + rename), one write at a time. */
  persist() {
    const snapshot = JSON.stringify(this.data);
    this.writing = this.writing.then(async () => {
      await fs.promises.mkdir(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      await fs.promises.writeFile(tmp, snapshot, { mode: 0o600 });
      await fs.promises.rename(tmp, this.file);
    });
    return this.writing;
  }
}

module.exports = { SecureStore };
