import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { SecretStore, CredentialsLockedError } from '../../src/store/secretStore.js';
import { makeTempStorageUri, createMockSecretStorage, window } from '../__mocks__/vscode.js';
import type { Logger } from '../../src/util/logger.js';

function makeLogger(): Logger {
  return {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  } as unknown as Logger;
}

function makeStore() {
  const uri = makeTempStorageUri();
  const secrets = createMockSecretStorage();
  const logger = makeLogger();
  const store = new SecretStore(secrets, uri, logger);
  return { store, uri, secrets };
}

describe('SecretStore', () => {
  describe('session management', () => {
    it('starts locked', () => {
      const { store } = makeStore();
      expect(store.isLocked).toBe(true);
    });

    it('unlocks on first call and generates master key', async () => {
      const { store } = makeStore();
      const ok = await store.unlock();
      expect(ok).toBe(true);
      expect(store.isLocked).toBe(false);
    });

    it('locks after lock() call', async () => {
      const { store } = makeStore();
      await store.unlock();
      store.lock();
      expect(store.isLocked).toBe(true);
    });

    it('can re-unlock after locking', async () => {
      const { store } = makeStore();
      await store.unlock();
      store.lock();
      const ok = await store.unlock();
      expect(ok).toBe(true);
      expect(store.isLocked).toBe(false);
    });
  });

  describe('credential storage', () => {
    it('throws CredentialsLockedError when locked', async () => {
      const { store } = makeStore();
      await expect(store.getCredential('any-id')).rejects.toThrow(CredentialsLockedError);
    });

    it('stores and retrieves auth token', async () => {
      const { store } = makeStore();
      await store.unlock();
      await store.addCredential('sub-id-1', 'my-secret-token');
      const retrieved = await store.getCredential('sub-id-1');
      expect(retrieved).toBe('my-secret-token');
    });

    it('credential is not stored as plaintext in credentials.enc.json', async () => {
      const { store, uri } = makeStore();
      await store.unlock();
      const token = 'super-secret-auth-token-12345';
      await store.addCredential('sub-id-1', token);

      const credsPath = path.join(uri.fsPath, 'twilio-admin', 'secure', 'credentials.enc.json');
      const raw = fs.readFileSync(credsPath, 'utf-8');
      expect(raw).not.toContain(token);
    });

    it('two adds for same id updates the credential', async () => {
      const { store } = makeStore();
      await store.unlock();
      await store.addCredential('sub-id-1', 'old-token');
      await store.addCredential('sub-id-1', 'new-token');
      const retrieved = await store.getCredential('sub-id-1');
      expect(retrieved).toBe('new-token');
    });

    it('different subaccounts get different ciphertext even for same token', async () => {
      const { store, uri } = makeStore();
      await store.unlock();
      const token = 'shared-token';
      await store.addCredential('sub-id-1', token);
      await store.addCredential('sub-id-2', token);

      const credsPath = path.join(uri.fsPath, 'twilio-admin', 'secure', 'credentials.enc.json');
      const parsed = JSON.parse(fs.readFileSync(credsPath, 'utf-8')) as {
        entries: Array<{ ciphertext: string }>;
      };
      expect(parsed.entries).toHaveLength(2);
      expect(parsed.entries[0].ciphertext).not.toBe(parsed.entries[1].ciphertext);
    });

    it('deletes credential and throws on subsequent get', async () => {
      const { store } = makeStore();
      await store.unlock();
      await store.addCredential('sub-id-1', 'token');
      await store.deleteCredential('sub-id-1');
      await expect(store.getCredential('sub-id-1')).rejects.toThrow();
    });
  });

  describe('lock enforcement', () => {
    it('getCredential throws after lock even if was unlocked', async () => {
      const { store } = makeStore();
      await store.unlock();
      await store.addCredential('sub-id-1', 'token');
      store.lock();
      await expect(store.getCredential('sub-id-1')).rejects.toThrow(CredentialsLockedError);
    });

    it('addCredential throws when locked', async () => {
      const { store } = makeStore();
      await expect(store.addCredential('sub-id-1', 'token')).rejects.toThrow(CredentialsLockedError);
    });
  });
});
