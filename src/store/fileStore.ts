import * as vscode from 'vscode';
import { z } from 'zod';
import type {
  SubaccountRecord,
  BookmarkRecord,
  PreferencesRecord,
  CacheEntry,
  LogHistoryRecord,
} from '../types/models.js';

// ── Zod schemas ───────────────────────────────────────────────────────────────

const SubaccountSchema = z.object({
  id: z.string().uuid(),
  friendlyName: z.string().min(1),
  accountSid: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const BookmarkSchema = z.object({
  id: z.string().uuid(),
  subaccountId: z.string().uuid(),
  phoneNumberSid: z.string().min(1),
  phoneNumber: z.string().min(1),
  label: z.string().min(1),
  notes: z.string().optional(),
  tags: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string().optional(),
});

const PreferencesSchema = z.object({
  activeTagFilter: z.string().nullable(),
  lastSelectedSubaccountId: z.string().nullable(),
  recentBookmarkIds: z.array(z.string()),
});

const DEFAULT_PREFERENCES: PreferencesRecord = {
  activeTagFilter: null,
  lastSelectedSubaccountId: null,
  recentBookmarkIds: [],
};

const ROOT = 'twilio-admin';
const LOG_HISTORY_VERSION = 1;

const CallLogEntrySchema = z.object({
  sid: z.string().min(1),
  from: z.string(),
  to: z.string(),
  direction: z.string(),
  status: z.string(),
  startTime: z.string().optional(),
  duration: z.number().optional(),
});

const MessageLogEntrySchema = z.object({
  sid: z.string().min(1),
  from: z.string(),
  to: z.string(),
  direction: z.string(),
  status: z.string(),
  dateSent: z.string().optional(),
  body: z.string().optional(),
});

const CallLogHistorySchema = z.object({
  version: z.literal(LOG_HISTORY_VERSION),
  kind: z.literal('call-logs'),
  key: z.string(),
  entries: z.array(CallLogEntrySchema),
  hasMore: z.boolean(),
  nextPageUrls: z.object({
    to: z.string().optional(),
    from: z.string().optional(),
  }).optional(),
  updatedAt: z.string(),
});

const MessageLogHistorySchema = z.object({
  version: z.literal(LOG_HISTORY_VERSION),
  kind: z.literal('message-logs'),
  key: z.string(),
  entries: z.array(MessageLogEntrySchema),
  hasMore: z.boolean(),
  nextPageUrls: z.object({
    to: z.string().optional(),
    from: z.string().optional(),
  }).optional(),
  updatedAt: z.string(),
});

export class FileStore {
  constructor(private readonly storageUri: vscode.Uri) {}

  // ── Subaccounts ─────────────────────────────────────────────────────────────

  async readSubaccounts(): Promise<SubaccountRecord[]> {
    return this.readJson('subaccounts.json', z.array(SubaccountSchema), []);
  }

  async writeSubaccounts(records: SubaccountRecord[]): Promise<void> {
    await this.writeJson('subaccounts.json', records);
  }

  // ── Bookmarks ───────────────────────────────────────────────────────────────

  async readBookmarks(): Promise<BookmarkRecord[]> {
    return this.readJson('bookmarks.json', z.array(BookmarkSchema), []);
  }

  async writeBookmarks(records: BookmarkRecord[]): Promise<void> {
    await this.writeJson('bookmarks.json', records);
  }

  // ── Preferences ─────────────────────────────────────────────────────────────

  async readPreferences(): Promise<PreferencesRecord> {
    return this.readJson('preferences.json', PreferencesSchema, DEFAULT_PREFERENCES);
  }

  async writePreferences(prefs: PreferencesRecord): Promise<void> {
    await this.writeJson('preferences.json', prefs);
  }

  // ── Cache ────────────────────────────────────────────────────────────────────

  async readCacheEntry<T>(
    type: 'call-logs' | 'message-logs',
    key: string,
    ttlSeconds: number
  ): Promise<T | null> {
    const safeName = this.safeCacheKey(key);
    const relativePath = `cache/${type}/${safeName}.json`;
    const schema = z.object({ cachedAt: z.string(), data: z.unknown() });
    const entry = await this.readJson<CacheEntry | null>(relativePath, schema as z.ZodSchema<CacheEntry>, null);
    if (!entry) {
      return null;
    }
    const age = (Date.now() - new Date(entry.cachedAt).getTime()) / 1000;
    if (age > ttlSeconds) {
      return null;
    }
    return entry.data as T;
  }

  async writeCacheEntry<T>(
    type: 'call-logs' | 'message-logs',
    key: string,
    data: T
  ): Promise<void> {
    const safeName = this.safeCacheKey(key);
    await this.ensureDir(`cache/${type}`);
    const entry: CacheEntry<T> = { cachedAt: new Date().toISOString(), data };
    await this.writeJson(`cache/${type}/${safeName}.json`, entry);
  }

  async readLogHistory<T>(
    type: 'call-logs' | 'message-logs',
    key: string
  ): Promise<LogHistoryRecord<T> | null> {
    const safeName = this.safeCacheKey(key);
    const schema = type === 'call-logs' ? CallLogHistorySchema : MessageLogHistorySchema;
    return this.readJson(`logs/${type}/${safeName}.json`, schema, null) as Promise<LogHistoryRecord<T> | null>;
  }

  async writeLogHistory<T>(
    type: 'call-logs' | 'message-logs',
    key: string,
    record: LogHistoryRecord<T>
  ): Promise<void> {
    const safeName = this.safeCacheKey(key);
    await this.ensureDir(`logs/${type}`);
    const normalized: LogHistoryRecord<T> = {
      ...record,
      version: LOG_HISTORY_VERSION,
    };
    await this.writeJson(`logs/${type}/${safeName}.json`, normalized);
  }

  async clearLogHistory(
    type: 'call-logs' | 'message-logs',
    key: string
  ): Promise<void> {
    const safeName = this.safeCacheKey(key);
    const uri = this.resolve(`logs/${type}/${safeName}.json`);
    try {
      await vscode.workspace.fs.delete(uri, { useTrash: false });
    } catch {
      // Missing history is fine.
    }
  }

  // ── Internal helpers ─────────────────────────────────────────────────────────

  private async readJson<T>(relativePath: string, schema: z.ZodSchema<T>, defaultValue: T): Promise<T> {
    const uri = this.resolve(relativePath);
    try {
      const raw = await vscode.workspace.fs.readFile(uri);
      const parsed: unknown = JSON.parse(Buffer.from(raw).toString('utf-8'));
      const result = schema.safeParse(parsed);
      if (result.success) {
        return result.data;
      }
      // Corrupt / schema-mismatched data — return default and log inline
      console.warn(`[FileStore] Schema validation failed for ${relativePath}:`, result.error.issues);
      return defaultValue;
    } catch (err) {
      // File not found is normal on first run
      if (this.isFileNotFound(err)) {
        return defaultValue;
      }
      console.warn(`[FileStore] Failed to read ${relativePath}:`, err);
      return defaultValue;
    }
  }

  private async writeJson(relativePath: string, data: unknown): Promise<void> {
    const uri = this.resolve(relativePath);
    const tmpUri = this.resolve(relativePath + '.tmp');
    const content = Buffer.from(JSON.stringify(data, null, 2), 'utf-8');

    // Ensure parent directory exists
    const parts = relativePath.split('/');
    if (parts.length > 1) {
      await this.ensureDir(parts.slice(0, -1).join('/'));
    }

    // Write to .tmp then rename for atomicity
    await vscode.workspace.fs.writeFile(tmpUri, content);
    try {
      await vscode.workspace.fs.rename(tmpUri, uri, { overwrite: true });
    } catch {
      // rename may fail on some platforms across devices; fall back to copy+delete
      await vscode.workspace.fs.copy(tmpUri, uri, { overwrite: true });
      await vscode.workspace.fs.delete(tmpUri, { useTrash: false });
    }
  }

  async ensureDir(relativePath: string): Promise<void> {
    const uri = this.resolve(relativePath);
    try {
      await vscode.workspace.fs.createDirectory(uri);
    } catch {
      // Directory may already exist — ignore
    }
  }

  private resolve(relativePath: string): vscode.Uri {
    return vscode.Uri.joinPath(this.storageUri, ROOT, relativePath);
  }

  private safeCacheKey(key: string): string {
    return key.replace(/[^a-zA-Z0-9_-]/g, '_');
  }

  private createLogHistorySchema() {
    return z.union([CallLogHistorySchema, MessageLogHistorySchema]);
  }

  private isFileNotFound(err: unknown): boolean {
    if (err instanceof Error) {
      return (
        err.message.includes('ENOENT') ||
        err.message.includes('FileNotFound') ||
        err.message.includes('EntryNotFound')
      );
    }
    return false;
  }
}
