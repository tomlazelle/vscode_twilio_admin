import * as vscode from 'vscode';
import * as crypto from 'crypto';
import type { CredentialStore, EncryptedCredentialEntry, EncryptionMetadata } from '../types/models.js';
import type { Logger } from '../util/logger.js';

export class CredentialsLockedError extends Error {
  constructor() {
    super('Credentials are locked. Please unlock before performing this operation.');
    this.name = 'CredentialsLockedError';
  }
}

const MASTER_KEY_SECRET = 'twilio-admin:master-key:v1';
const ROOT = 'twilio-admin';
const CREDS_FILE = 'secure/credentials.enc.json';
const META_FILE = 'secure/metadata.json';

export class SecretStore {
  private sessionUnlocked = false;
  private masterKey: Buffer | null = null;

  constructor(
    private readonly secrets: vscode.SecretStorage,
    private readonly storageUri: vscode.Uri,
    private readonly logger: Logger
  ) {}

  // ── Session ──────────────────────────────────────────────────────────────────

  get isLocked(): boolean {
    return !this.sessionUnlocked;
  }

  async unlock(passphrase?: string): Promise<boolean> {
    try {
      const stored = await this.secrets.get(MASTER_KEY_SECRET);
      if (stored) {
        this.masterKey = Buffer.from(stored, 'base64');
        this.sessionUnlocked = true;
        this.logger.info('Credentials unlocked via SecretStorage.');
        return true;
      }

      // No master key yet — create one and persist it
      if (!passphrase) {
        // Fresh install: generate and store master key
        const newKey = crypto.randomBytes(32);
        await this.secrets.store(MASTER_KEY_SECRET, newKey.toString('base64'));
        await this.saveMetadata({ masterKeyRef: MASTER_KEY_SECRET, createdAt: new Date().toISOString() });
        this.masterKey = newKey;
        this.sessionUnlocked = true;
        this.logger.info('New master key generated and stored.');
        return true;
      }

      // Passphrase fallback
      const config = vscode.workspace.getConfiguration('twilioAdmin');
      if (!config.get<boolean>('security.passphraseFallbackEnabled')) {
        this.logger.warn('Passphrase fallback is disabled.');
        return false;
      }
      const meta = await this.loadMetadata();
      const salt = meta?.kdfSalt
        ? Buffer.from(meta.kdfSalt, 'base64')
        : crypto.randomBytes(32);

      const derived = await this.deriveMasterKey(passphrase, salt);
      if (!meta?.kdfSalt) {
        await this.saveMetadata({
          masterKeyRef: 'passphrase',
          kdfSalt: salt.toString('base64'),
          kdfIterations: 600_000,
          createdAt: new Date().toISOString(),
        });
      }
      this.masterKey = derived;
      this.sessionUnlocked = true;
      this.logger.info('Credentials unlocked via passphrase fallback.');
      return true;
    } catch (err) {
      this.logger.error('Failed to unlock credentials', err);
      return false;
    }
  }

  lock(): void {
    if (this.masterKey) {
      this.masterKey.fill(0);
      this.masterKey = null;
    }
    this.sessionUnlocked = false;
    this.logger.info('Credentials locked.');
  }

  // ── Credential operations ────────────────────────────────────────────────────

  async addCredential(subaccountId: string, authToken: string): Promise<void> {
    this.assertUnlocked();
    const store = await this.loadStore();
    const existing = store.entries.findIndex(e => e.subaccountId === subaccountId);
    const entry = this.encryptToken(subaccountId, authToken);
    if (existing >= 0) {
      store.entries[existing] = entry;
    } else {
      store.entries.push(entry);
    }
    await this.saveStore(store);
  }

  async getCredential(subaccountId: string): Promise<string> {
    this.assertUnlocked();
    const store = await this.loadStore();
    const entry = store.entries.find(e => e.subaccountId === subaccountId);
    if (!entry) {
      throw new Error(`No credential found for subaccount ${subaccountId}`);
    }
    return this.decryptToken(entry);
  }

  async updateCredential(subaccountId: string, authToken: string): Promise<void> {
    await this.addCredential(subaccountId, authToken);
  }

  async deleteCredential(subaccountId: string): Promise<void> {
    this.assertUnlocked();
    const store = await this.loadStore();
    store.entries = store.entries.filter(e => e.subaccountId !== subaccountId);
    await this.saveStore(store);
  }

  async secureErase(subaccountId: string): Promise<void> {
    await this.deleteCredential(subaccountId);
  }

  // ── Crypto ───────────────────────────────────────────────────────────────────

  private encryptToken(subaccountId: string, authToken: string): EncryptedCredentialEntry {
    const masterKey = this.masterKey!;

    // Generate a per-record data key
    const dataKey = crypto.randomBytes(32);

    // Encrypt the auth token with the data key
    const tokenIv = crypto.randomBytes(12);
    const tokenCipher = crypto.createCipheriv('aes-256-gcm', dataKey, tokenIv);
    const tokenCiphertext = Buffer.concat([
      tokenCipher.update(Buffer.from(authToken, 'utf-8')),
      tokenCipher.final(),
    ]);
    const tokenAuthTag = tokenCipher.getAuthTag();

    // Wrap the data key with the master key
    const dkIv = crypto.randomBytes(12);
    const dkCipher = crypto.createCipheriv('aes-256-gcm', masterKey, dkIv);
    const dkCiphertext = Buffer.concat([
      dkCipher.update(dataKey),
      dkCipher.final(),
    ]);
    const dkAuthTag = dkCipher.getAuthTag();

    // Zero out data key from memory
    dataKey.fill(0);

    return {
      subaccountId,
      ciphertext: tokenCiphertext.toString('base64'),
      iv: tokenIv.toString('base64'),
      authTag: tokenAuthTag.toString('base64'),
      dataKeyEncrypted: dkCiphertext.toString('base64'),
      dataKeyIv: dkIv.toString('base64'),
      dataKeyAuthTag: dkAuthTag.toString('base64'),
      version: 1,
    };
  }

  private decryptToken(entry: EncryptedCredentialEntry): string {
    const masterKey = this.masterKey!;

    // Unwrap the data key
    const dkDecipher = crypto.createDecipheriv(
      'aes-256-gcm',
      masterKey,
      Buffer.from(entry.dataKeyIv, 'base64')
    );
    dkDecipher.setAuthTag(Buffer.from(entry.dataKeyAuthTag, 'base64'));
    const dataKey = Buffer.concat([
      dkDecipher.update(Buffer.from(entry.dataKeyEncrypted, 'base64')),
      dkDecipher.final(),
    ]);

    // Decrypt the auth token
    const tokenDecipher = crypto.createDecipheriv(
      'aes-256-gcm',
      dataKey,
      Buffer.from(entry.iv, 'base64')
    );
    tokenDecipher.setAuthTag(Buffer.from(entry.authTag, 'base64'));
    const plaintext = Buffer.concat([
      tokenDecipher.update(Buffer.from(entry.ciphertext, 'base64')),
      tokenDecipher.final(),
    ]);

    dataKey.fill(0);
    return plaintext.toString('utf-8');
  }

  private async deriveMasterKey(passphrase: string, salt: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      crypto.pbkdf2(passphrase, salt, 600_000, 32, 'sha256', (err, key) => {
        if (err) { reject(err); } else { resolve(key); }
      });
    });
  }

  // ── Persistence ──────────────────────────────────────────────────────────────

  private async loadStore(): Promise<CredentialStore> {
    const uri = this.resolve(CREDS_FILE);
    try {
      const raw = await vscode.workspace.fs.readFile(uri);
      return JSON.parse(Buffer.from(raw).toString('utf-8')) as CredentialStore;
    } catch {
      return { version: 1, entries: [] };
    }
  }

  private async saveStore(store: CredentialStore): Promise<void> {
    await this.ensureSecureDir();
    const uri = this.resolve(CREDS_FILE);
    await vscode.workspace.fs.writeFile(
      uri,
      Buffer.from(JSON.stringify(store, null, 2), 'utf-8')
    );
  }

  private async loadMetadata(): Promise<EncryptionMetadata | null> {
    const uri = this.resolve(META_FILE);
    try {
      const raw = await vscode.workspace.fs.readFile(uri);
      return JSON.parse(Buffer.from(raw).toString('utf-8')) as EncryptionMetadata;
    } catch {
      return null;
    }
  }

  private async saveMetadata(meta: EncryptionMetadata): Promise<void> {
    await this.ensureSecureDir();
    const uri = this.resolve(META_FILE);
    await vscode.workspace.fs.writeFile(
      uri,
      Buffer.from(JSON.stringify(meta, null, 2), 'utf-8')
    );
  }

  private async ensureSecureDir(): Promise<void> {
    const uri = this.resolve('secure');
    try {
      await vscode.workspace.fs.createDirectory(uri);
    } catch {
      // Already exists
    }
  }

  private resolve(relativePath: string): vscode.Uri {
    return vscode.Uri.joinPath(this.storageUri, ROOT, relativePath);
  }

  private assertUnlocked(): void {
    if (!this.sessionUnlocked || !this.masterKey) {
      throw new CredentialsLockedError();
    }
  }
}
