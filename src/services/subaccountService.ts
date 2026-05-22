import { v4 as uuidv4 } from 'uuid';
import type { SubaccountRecord } from '../types/models.js';
import type { FileStore } from '../store/fileStore.js';
import type { SecretStore } from '../store/secretStore.js';

export interface AddAccountInput {
  friendlyName: string;
  accountSid: string;
  authToken: string;
}

export interface UpdateAccountInput {
  friendlyName?: string;
  accountSid?: string;
  authToken?: string;
}

export class SubaccountService {
  constructor(
    private readonly fileStore: FileStore,
    private readonly secretStore: SecretStore
  ) {}

  async getAll(): Promise<SubaccountRecord[]> {
    const records = await this.fileStore.readSubaccounts();
    return records.sort((a, b) => a.friendlyName.localeCompare(b.friendlyName));
  }

  async getById(id: string): Promise<SubaccountRecord | undefined> {
    const records = await this.fileStore.readSubaccounts();
    return records.find(r => r.id === id);
  }

  async add(input: AddAccountInput): Promise<SubaccountRecord> {
    const now = new Date().toISOString();
    const record: SubaccountRecord = {
      id: uuidv4(),
      friendlyName: input.friendlyName.trim(),
      accountSid: input.accountSid.trim(),
      createdAt: now,
      updatedAt: now,
    };

    const records = await this.fileStore.readSubaccounts();
    records.push(record);
    await this.fileStore.writeSubaccounts(records);

    // Store credential — roll back if this fails
    try {
      await this.secretStore.addCredential(record.id, input.authToken);
    } catch (err) {
      const updated = records.filter(r => r.id !== record.id);
      await this.fileStore.writeSubaccounts(updated);
      throw err;
    }

    return record;
  }

  async update(id: string, input: UpdateAccountInput): Promise<SubaccountRecord> {
    const records = await this.fileStore.readSubaccounts();
    const idx = records.findIndex(r => r.id === id);
    if (idx < 0) {
      throw new Error(`Subaccount ${id} not found`);
    }

    const existing = records[idx];
    const updated: SubaccountRecord = {
      ...existing,
      friendlyName: input.friendlyName?.trim() ?? existing.friendlyName,
      accountSid: input.accountSid?.trim() ?? existing.accountSid,
      updatedAt: new Date().toISOString(),
    };
    records[idx] = updated;
    await this.fileStore.writeSubaccounts(records);

    if (input.authToken) {
      await this.secretStore.updateCredential(id, input.authToken);
    }

    return updated;
  }

  async delete(id: string): Promise<void> {
    // Remove bookmarks for this subaccount
    const bookmarks = await this.fileStore.readBookmarks();
    const remaining = bookmarks.filter(b => b.subaccountId !== id);
    await this.fileStore.writeBookmarks(remaining);

    // Remove the subaccount record
    const records = await this.fileStore.readSubaccounts();
    await this.fileStore.writeSubaccounts(records.filter(r => r.id !== id));

    // Secure erase credential
    try {
      await this.secretStore.secureErase(id);
    } catch {
      // Best-effort — credential may not exist if account was added without unlock
    }
  }

  async getCredential(id: string): Promise<string> {
    return this.secretStore.getCredential(id);
  }
}
