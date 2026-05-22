import { v4 as uuidv4 } from 'uuid';
import type { BookmarkRecord } from '../types/models.js';
import type { FileStore } from '../store/fileStore.js';

export interface AddBookmarkInput {
  subaccountId: string;
  phoneNumberSid: string;
  phoneNumber: string;
  label: string;
  notes?: string;
  tags?: string[];
}

export class BookmarkService {
  constructor(private readonly fileStore: FileStore) {}

  async getAll(): Promise<BookmarkRecord[]> {
    return this.fileStore.readBookmarks();
  }

  async getById(id: string): Promise<BookmarkRecord | undefined> {
    const records = await this.fileStore.readBookmarks();
    return records.find(r => r.id === id);
  }

  async getBySubaccountId(subaccountId: string): Promise<BookmarkRecord[]> {
    const records = await this.fileStore.readBookmarks();
    return records.filter(r => r.subaccountId === subaccountId);
  }

  async getByTag(tag: string): Promise<BookmarkRecord[]> {
    const normalized = this.normalizeTag(tag);
    const records = await this.fileStore.readBookmarks();
    return records.filter(r => r.tags.includes(normalized));
  }

  async getAllTags(): Promise<string[]> {
    const records = await this.fileStore.readBookmarks();
    const tagSet = new Set<string>();
    for (const r of records) {
      for (const t of r.tags) {
        tagSet.add(t);
      }
    }
    return Array.from(tagSet).sort();
  }

  async existsForPhoneNumberSid(phoneNumberSid: string): Promise<boolean> {
    const records = await this.fileStore.readBookmarks();
    return records.some(r => r.phoneNumberSid === phoneNumberSid);
  }

  async getIdForPhoneNumberSid(phoneNumberSid: string): Promise<string | undefined> {
    const records = await this.fileStore.readBookmarks();
    return records.find(r => r.phoneNumberSid === phoneNumberSid)?.id;
  }

  async add(input: AddBookmarkInput): Promise<BookmarkRecord> {
    const now = new Date().toISOString();
    const record: BookmarkRecord = {
      id: uuidv4(),
      subaccountId: input.subaccountId,
      phoneNumberSid: input.phoneNumberSid,
      phoneNumber: input.phoneNumber,
      label: input.label.trim(),
      notes: input.notes?.trim(),
      tags: (input.tags ?? []).map(t => this.normalizeTag(t)),
      createdAt: now,
    };

    const records = await this.fileStore.readBookmarks();
    records.push(record);
    await this.fileStore.writeBookmarks(records);
    return record;
  }

  async updateLabel(id: string, label: string, notes?: string): Promise<void> {
    await this.updateRecord(id, r => ({
      ...r,
      label: label.trim(),
      notes: notes?.trim(),
      updatedAt: new Date().toISOString(),
    }));
  }

  async updateTags(id: string, tags: string[]): Promise<void> {
    await this.updateRecord(id, r => ({
      ...r,
      tags: tags.map(t => this.normalizeTag(t)),
      updatedAt: new Date().toISOString(),
    }));
  }

  async delete(id: string): Promise<void> {
    const records = await this.fileStore.readBookmarks();
    await this.fileStore.writeBookmarks(records.filter(r => r.id !== id));
  }

  private async updateRecord(
    id: string,
    transform: (r: BookmarkRecord) => BookmarkRecord
  ): Promise<void> {
    const records = await this.fileStore.readBookmarks();
    const idx = records.findIndex(r => r.id === id);
    if (idx < 0) {
      throw new Error(`Bookmark ${id} not found`);
    }
    records[idx] = transform(records[idx]);
    await this.fileStore.writeBookmarks(records);
  }

  private normalizeTag(tag: string): string {
    return tag.toLowerCase().trim();
  }
}
