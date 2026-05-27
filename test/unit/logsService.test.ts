import { describe, it, expect, vi, afterEach } from 'vitest';
import { LogsService } from '../../src/services/logsService.js';
import { FileStore } from '../../src/store/fileStore.js';
import { makeTempStorageUri, workspace } from '../__mocks__/vscode.js';
import type { CallLogEntry, MessageLogEntry, LogPageResult } from '../../src/types/models.js';

afterEach(() => {
  vi.restoreAllMocks();
});

function makeFileStore() {
  return new FileStore(makeTempStorageUri());
}

function makeCallEntry(sid: string, startTime: string): CallLogEntry {
  return {
    sid,
    from: '+15005550001',
    to: '+15005550002',
    direction: 'outbound-api',
    status: 'completed',
    startTime,
  };
}

function makeMessageEntry(sid: string, dateSent: string): MessageLogEntry {
  return {
    sid,
    from: '+15005550001',
    to: '+15005550002',
    direction: 'outbound-api',
    status: 'sent',
    dateSent,
  };
}

describe('LogsService', () => {
  it('stores the first call log page and returns it', async () => {
    const fileStore = makeFileStore();
    const twilioService = {
      getCallLogsPage: vi.fn(async (): Promise<LogPageResult<CallLogEntry>> => ({
        entries: [makeCallEntry('CA2', '2025-01-02T10:00:00.000Z'), makeCallEntry('CA1', '2025-01-01T10:00:00.000Z')],
        hasMore: true,
        nextPageUrls: { to: 'next-to', from: 'next-from' },
        updatedAt: '2025-01-02T10:00:00.000Z',
      })),
      getMessageLogsPage: vi.fn(),
    } as any;

    const service = new LogsService(twilioService, fileStore);
    const result = await service.getCallLogs('sub-1', '+15005550001');

    expect(result.entries.map(entry => entry.sid)).toEqual(['CA2', 'CA1']);
    expect(result.hasMore).toBe(true);
    expect(result.nextPageUrls).toEqual({ to: 'next-to', from: 'next-from' });
    expect(twilioService.getCallLogsPage).toHaveBeenCalledTimes(1);

    const stored = await fileStore.readLogHistory<CallLogEntry>('call-logs', 'sub-1:+15005550001');
    expect(stored?.entries.map(entry => entry.sid)).toEqual(['CA2', 'CA1']);
    expect(stored?.hasMore).toBe(true);
  });

  it('resumes call logs from stored next-page cursors when loadMore is requested', async () => {
    const fileStore = makeFileStore();
    const key = 'sub-1:+15005550001';
    const updatedAt = new Date().toISOString();
    await fileStore.writeLogHistory('call-logs', key, {
      version: 1,
      kind: 'call-logs',
      key,
      entries: [makeCallEntry('CA2', '2025-01-02T10:00:00.000Z')],
      hasMore: true,
      nextPageUrls: { to: 'next-to', from: 'next-from' },
      updatedAt,
    });

    const twilioService = {
      getCallLogsPage: vi.fn(async (): Promise<LogPageResult<CallLogEntry>> => ({
        entries: [makeCallEntry('CA1', '2025-01-01T10:00:00.000Z')],
        hasMore: false,
        nextPageUrls: {},
        updatedAt: '2025-01-01T10:00:00.000Z',
      })),
      getMessageLogsPage: vi.fn(),
    } as any;

    const service = new LogsService(twilioService, fileStore);
    const result = await service.getCallLogs('sub-1', '+15005550001', { loadMore: true });

    expect(twilioService.getCallLogsPage).toHaveBeenCalledWith(
      'sub-1',
      '+15005550001',
      50,
      { to: 'next-to', from: 'next-from' },
      undefined
    );
    expect(result.entries.map(entry => entry.sid)).toEqual(['CA2', 'CA1']);
    expect(result.hasMore).toBe(false);
  });

  it('returns stored message logs when already loaded and not loading more', async () => {
    const fileStore = makeFileStore();
    const key = 'sub-1:+15005550001';
    const updatedAt = new Date().toISOString();
    await fileStore.writeLogHistory('message-logs', key, {
      version: 1,
      kind: 'message-logs',
      key,
      entries: [makeMessageEntry('SM1', '2025-01-01T10:00:00.000Z')],
      hasMore: false,
      updatedAt,
    });

    const twilioService = {
      getCallLogsPage: vi.fn(),
      getMessageLogsPage: vi.fn(),
    } as any;

    const service = new LogsService(twilioService, fileStore);
    const result = await service.getMessageLogs('sub-1', '+15005550001');

    expect(result.entries.map(entry => entry.sid)).toEqual(['SM1']);
    expect(twilioService.getMessageLogsPage).not.toHaveBeenCalled();
  });

  it('skips reading history after force refresh clears it', async () => {
    const fileStore = {
      clearLogHistory: vi.fn(async () => undefined),
      readLogHistory: vi.fn(async () => null),
      writeLogHistory: vi.fn(async () => undefined),
    } as any;

    const twilioService = {
      getCallLogsPage: vi.fn(async (): Promise<LogPageResult<CallLogEntry>> => ({
        entries: [makeCallEntry('CA1', '2025-01-01T10:00:00.000Z')],
        hasMore: false,
        nextPageUrls: {},
        updatedAt: '2025-01-01T10:00:00.000Z',
      })),
      getMessageLogsPage: vi.fn(),
    } as any;

    const service = new LogsService(twilioService, fileStore);
    await service.getCallLogs('sub-1', '+15005550001', { forceRefresh: true });

    expect(fileStore.clearLogHistory).toHaveBeenCalledTimes(1);
    expect(fileStore.readLogHistory).not.toHaveBeenCalled();
  });

  it('does not write log history when cache.enabled is false', async () => {
    const fileStore = {
      clearLogHistory: vi.fn(async () => undefined),
      readLogHistory: vi.fn(async () => null),
      writeLogHistory: vi.fn(async () => undefined),
    } as any;

    const twilioService = {
      getCallLogsPage: vi.fn(async (): Promise<LogPageResult<CallLogEntry>> => ({
        entries: [makeCallEntry('CA1', '2025-01-01T10:00:00.000Z')],
        hasMore: false,
        nextPageUrls: {},
        updatedAt: '2025-01-01T10:00:00.000Z',
      })),
      getMessageLogsPage: vi.fn(),
    } as any;

    const configSpy = vi.spyOn(workspace, 'getConfiguration').mockReturnValue({
      get<T>(key: string, defaultValue?: T): T | undefined {
        if (key === 'cache.enabled') {
          return false as unknown as T;
        }
        if (key === 'logs.pageSize') {
          return 50 as unknown as T;
        }
        return defaultValue;
      },
    } as any);

    const service = new LogsService(twilioService, fileStore);
    await service.getCallLogs('sub-1', '+15005550001');

    expect(fileStore.writeLogHistory).not.toHaveBeenCalled();
    configSpy.mockRestore();
  });
});
