import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { FileStore } from '../../src/store/fileStore.js';
import { makeTempStorageUri, Uri } from '../__mocks__/vscode.js';
import type { SubaccountRecord, BookmarkRecord, CallLogEntry, LogHistoryRecord } from '../../src/types/models.js';

function makeStorage(): { store: FileStore; dir: string } {
  const uri = makeTempStorageUri();
  return { store: new FileStore(uri), dir: uri.fsPath };
}

function makeSubaccount(overrides?: Partial<SubaccountRecord>): SubaccountRecord {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    friendlyName: 'Test Account',
    accountSid: 'ACtest00000000000000000000000000000',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeBookmark(overrides?: Partial<BookmarkRecord>): BookmarkRecord {
  return {
    id: '22222222-2222-2222-2222-222222222222',
    subaccountId: '11111111-1111-1111-1111-111111111111',
    phoneNumberSid: 'PN0000000000000000000000000000001',
    phoneNumber: '+15005550001',
    label: 'My Number',
    tags: ['test'],
    createdAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('FileStore', () => {
  describe('subaccounts', () => {
    it('returns empty array when file does not exist', async () => {
      const { store } = makeStorage();
      const result = await store.readSubaccounts();
      expect(result).toEqual([]);
    });

    it('round-trips subaccount records correctly', async () => {
      const { store } = makeStorage();
      const records = [makeSubaccount(), makeSubaccount({ id: '33333333-3333-3333-3333-333333333333' })];
      await store.writeSubaccounts(records);
      const read = await store.readSubaccounts();
      expect(read).toEqual(records);
    });

    it('returns default and does not throw on corrupt JSON', async () => {
      const { store, dir } = makeStorage();
      const filePath = path.join(dir, 'twilio-admin', 'subaccounts.json');
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, 'not valid json');
      const result = await store.readSubaccounts();
      expect(result).toEqual([]);
    });

    it('returns default when schema validation fails', async () => {
      const { store, dir } = makeStorage();
      const filePath = path.join(dir, 'twilio-admin', 'subaccounts.json');
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      // Missing required fields
      fs.writeFileSync(filePath, JSON.stringify([{ id: 'bad-id', name: 'wrong field' }]));
      const result = await store.readSubaccounts();
      expect(result).toEqual([]);
    });
  });

  describe('bookmarks', () => {
    it('returns empty array when file does not exist', async () => {
      const { store } = makeStorage();
      const result = await store.readBookmarks();
      expect(result).toEqual([]);
    });

    it('round-trips bookmark records including tags', async () => {
      const { store } = makeStorage();
      const records = [makeBookmark({ tags: ['production', 'sms'] })];
      await store.writeBookmarks(records);
      const read = await store.readBookmarks();
      expect(read).toEqual(records);
    });

    it('preserves optional notes field when undefined', async () => {
      const { store } = makeStorage();
      const record = makeBookmark({ notes: undefined });
      await store.writeBookmarks([record]);
      const [read] = await store.readBookmarks();
      expect(read.notes).toBeUndefined();
    });
  });

  describe('preferences', () => {
    it('returns default preferences when file does not exist', async () => {
      const { store } = makeStorage();
      const prefs = await store.readPreferences();
      expect(prefs.activeTagFilter).toBeNull();
      expect(prefs.lastSelectedSubaccountId).toBeNull();
      expect(prefs.recentBookmarkIds).toEqual([]);
    });

    it('round-trips preferences correctly', async () => {
      const { store } = makeStorage();
      await store.writePreferences({
        activeTagFilter: 'production',
        lastSelectedSubaccountId: '11111111-1111-1111-1111-111111111111',
        recentBookmarkIds: ['22222222-2222-2222-2222-222222222222'],
      });
      const read = await store.readPreferences();
      expect(read.activeTagFilter).toBe('production');
      expect(read.lastSelectedSubaccountId).toBe('11111111-1111-1111-1111-111111111111');
    });
  });

  describe('cache', () => {
    it('returns null when no cache entry exists', async () => {
      const { store } = makeStorage();
      const result = await store.readCacheEntry('call-logs', 'test-key', 120);
      expect(result).toBeNull();
    });

    it('returns cached data within TTL', async () => {
      const { store } = makeStorage();
      const data = [{ sid: 'CA001', from: '+1', to: '+2', direction: 'inbound', status: 'completed' }];
      await store.writeCacheEntry('call-logs', 'acc:num', data);
      const read = await store.readCacheEntry('call-logs', 'acc:num', 120);
      expect(read).toEqual(data);
    });

    it('returns null when TTL is exceeded', async () => {
      const { store, dir } = makeStorage();
      const key = 'acc:num';
      const safeKey = 'acc_num';
      const stale = {
        cachedAt: new Date(Date.now() - 200_000).toISOString(), // 200s ago
        data: ['stale'],
      };
      const filePath = path.join(dir, 'twilio-admin', 'cache', 'call-logs', `${safeKey}.json`);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(stale));
      const result = await store.readCacheEntry('call-logs', key, 120);
      expect(result).toBeNull();
    });

    it('works for message-logs type', async () => {
      const { store } = makeStorage();
      const data = [{ sid: 'SM001' }];
      await store.writeCacheEntry('message-logs', 'acc:+15005550001', data);
      const read = await store.readCacheEntry('message-logs', 'acc:+15005550001', 300);
      expect(read).toEqual(data);
    });
  });

  describe('log history', () => {
    it('round-trips call log history records', async () => {
      const { store } = makeStorage();
      const record: LogHistoryRecord<CallLogEntry> = {
        version: 1,
        kind: 'call-logs',
        key: 'sub-1:+15005550001',
        entries: [{ sid: 'CA001', from: '+1', to: '+2', direction: 'inbound', status: 'completed' }],
        hasMore: true,
        nextPageUrls: { to: 'https://example.test/to', from: 'https://example.test/from' },
        updatedAt: new Date().toISOString(),
      };

      await store.writeLogHistory('call-logs', record.key, record);
      const read = await store.readLogHistory<CallLogEntry>('call-logs', record.key);
      expect(read).toEqual(record);
    });

    it('clears log history records', async () => {
      const { store } = makeStorage();
      const key = 'sub-1:+15005550001';
      await store.writeLogHistory('message-logs', key, {
        version: 1,
        kind: 'message-logs',
        key,
        entries: [{ sid: 'SM001' }],
        hasMore: false,
        updatedAt: new Date().toISOString(),
      });

      await store.clearLogHistory('message-logs', key);
      const read = await store.readLogHistory('message-logs', key);
      expect(read).toBeNull();
    });

    it('rejects malformed log entries and returns null', async () => {
      const { store, dir } = makeStorage();
      const key = 'sub-1:+15005550001';
      const filePath = path.join(dir, 'twilio-admin', 'logs', 'call-logs', 'sub-1__15005550001.json');
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify({
        version: 1,
        kind: 'call-logs',
        key,
        entries: [{ from: '+1', to: '+2', direction: 'inbound', status: 'completed' }],
        hasMore: false,
        updatedAt: new Date().toISOString(),
      }));

      const read = await store.readLogHistory('call-logs', key);
      expect(read).toBeNull();
    });
  });

  describe('atomic writes', () => {
    it('does not leave .tmp file after successful write', async () => {
      const { store, dir } = makeStorage();
      await store.writeSubaccounts([makeSubaccount()]);
      const tmpPath = path.join(dir, 'twilio-admin', 'subaccounts.json.tmp');
      expect(fs.existsSync(tmpPath)).toBe(false);
    });

    it('survives multiple sequential writes', async () => {
      const { store } = makeStorage();
      for (let i = 0; i < 5; i++) {
        const record = makeSubaccount({ friendlyName: `Account ${i}` });
        await store.writeSubaccounts([record]);
      }
      const final = await store.readSubaccounts();
      expect(final[0].friendlyName).toBe('Account 4');
    });
  });
});
