import * as vscode from 'vscode';
import type { CallLogEntry, LogHistoryRecord, LogPageResult, MessageLogEntry } from '../types/models.js';
import type { TwilioService } from './twilioService.js';
import type { FileStore } from '../store/fileStore.js';
import { dedupeBySid, sortByTimestampThenSid } from '../util/logEntrySorting.js';

interface GetLogsOptions {
  forceRefresh?: boolean;
  loadMore?: boolean;
}

export class LogsService {
  private readonly runtimeCallHistory = new Map<string, LogHistoryRecord<CallLogEntry>>();
  private readonly runtimeMessageHistory = new Map<string, LogHistoryRecord<MessageLogEntry>>();

  constructor(
    private readonly twilioService: TwilioService,
    private readonly fileStore: FileStore
  ) {}

  async getCallLogs(
    subaccountId: string,
    phoneNumber: string,
    options: GetLogsOptions = {},
    token?: vscode.CancellationToken
  ): Promise<LogPageResult<CallLogEntry>> {
    const config = vscode.workspace.getConfiguration('twilioAdmin');
    const pageSize = config.get<number>('logs.pageSize') ?? 50;
    const key = `${subaccountId}:${phoneNumber}`;
    const forceRefresh = options.forceRefresh ?? false;
    const loadMore = options.loadMore ?? false;
    const cacheConfig = this.getCacheConfig();

    if (forceRefresh) {
      this.runtimeCallHistory.delete(key);
      if (cacheConfig.enabled) {
        await this.fileStore.clearLogHistory('call-logs', key);
      }
    }

    const existing = forceRefresh ? null : await this.readCallHistory(key, cacheConfig);

    if (!forceRefresh && existing && !loadMore) {
      return {
        entries: existing.entries,
        hasMore: existing.hasMore,
        nextPageUrls: existing.nextPageUrls,
        updatedAt: existing.updatedAt,
      };
    }

    if (loadMore && existing && !existing.hasMore) {
      return {
        entries: existing.entries,
        hasMore: existing.hasMore,
        nextPageUrls: existing.nextPageUrls,
        updatedAt: existing.updatedAt,
      };
    }

    const page = await this.twilioService.getCallLogsPage(
      subaccountId,
      phoneNumber,
      pageSize,
      loadMore ? existing?.nextPageUrls : undefined,
      token
    );
    const mergedEntries = sortByTimestampThenSid(
      dedupeBySid([...(forceRefresh ? [] : (existing?.entries ?? [])), ...page.entries]),
      entry => entry.startTime,
    );
    const record: LogHistoryRecord<CallLogEntry> = {
      version: 1,
      kind: 'call-logs',
      key,
      entries: mergedEntries,
      hasMore: page.hasMore,
      nextPageUrls: page.nextPageUrls,
      updatedAt: page.updatedAt,
    };

    this.runtimeCallHistory.set(key, record);
    if (cacheConfig.enabled) {
      await this.fileStore.writeLogHistory('call-logs', key, record);
    }

    return {
      entries: record.entries,
      hasMore: record.hasMore,
      nextPageUrls: record.nextPageUrls,
      updatedAt: record.updatedAt,
    };
  }

  async getMessageLogs(
    subaccountId: string,
    phoneNumber: string,
    options: GetLogsOptions = {},
    token?: vscode.CancellationToken
  ): Promise<LogPageResult<MessageLogEntry>> {
    const config = vscode.workspace.getConfiguration('twilioAdmin');
    const pageSize = config.get<number>('logs.pageSize') ?? 50;
    const key = `${subaccountId}:${phoneNumber}`;
    const forceRefresh = options.forceRefresh ?? false;
    const loadMore = options.loadMore ?? false;
    const cacheConfig = this.getCacheConfig();

    if (forceRefresh) {
      this.runtimeMessageHistory.delete(key);
      if (cacheConfig.enabled) {
        await this.fileStore.clearLogHistory('message-logs', key);
      }
    }

    const existing = forceRefresh ? null : await this.readMessageHistory(key, cacheConfig);

    if (!forceRefresh && existing && !loadMore) {
      return {
        entries: existing.entries,
        hasMore: existing.hasMore,
        nextPageUrls: existing.nextPageUrls,
        updatedAt: existing.updatedAt,
      };
    }

    if (loadMore && existing && !existing.hasMore) {
      return {
        entries: existing.entries,
        hasMore: existing.hasMore,
        nextPageUrls: existing.nextPageUrls,
        updatedAt: existing.updatedAt,
      };
    }

    const page = await this.twilioService.getMessageLogsPage(
      subaccountId,
      phoneNumber,
      pageSize,
      loadMore ? existing?.nextPageUrls : undefined,
      token
    );
    const mergedEntries = sortByTimestampThenSid(
      dedupeBySid([...(forceRefresh ? [] : (existing?.entries ?? [])), ...page.entries]),
      entry => entry.dateSent,
    );
    const record: LogHistoryRecord<MessageLogEntry> = {
      version: 1,
      kind: 'message-logs',
      key,
      entries: mergedEntries,
      hasMore: page.hasMore,
      nextPageUrls: page.nextPageUrls,
      updatedAt: page.updatedAt,
    };

    this.runtimeMessageHistory.set(key, record);
    if (cacheConfig.enabled) {
      await this.fileStore.writeLogHistory('message-logs', key, record);
    }

    return {
      entries: record.entries,
      hasMore: record.hasMore,
      nextPageUrls: record.nextPageUrls,
      updatedAt: record.updatedAt,
    };
  }

  private getCacheConfig(): { enabled: boolean; ttlSeconds: number } {
    const config = vscode.workspace.getConfiguration('twilioAdmin');
    return {
      enabled: config.get<boolean>('cache.enabled') ?? true,
      ttlSeconds: config.get<number>('cache.ttlSeconds') ?? 120,
    };
  }

  private async readCallHistory(key: string, cacheConfig: { enabled: boolean; ttlSeconds: number }): Promise<LogHistoryRecord<CallLogEntry> | null> {
    const runtime = this.runtimeCallHistory.get(key) ?? null;
    if (runtime) {
      return runtime;
    }
    if (!cacheConfig.enabled) {
      return null;
    }

    const persisted = await this.fileStore.readLogHistory<CallLogEntry>('call-logs', key);
    if (!persisted) {
      return null;
    }
    if (this.isExpired(persisted.updatedAt, cacheConfig.ttlSeconds)) {
      return null;
    }

    this.runtimeCallHistory.set(key, persisted);
    return persisted;
  }

  private async readMessageHistory(key: string, cacheConfig: { enabled: boolean; ttlSeconds: number }): Promise<LogHistoryRecord<MessageLogEntry> | null> {
    const runtime = this.runtimeMessageHistory.get(key) ?? null;
    if (runtime) {
      return runtime;
    }
    if (!cacheConfig.enabled) {
      return null;
    }

    const persisted = await this.fileStore.readLogHistory<MessageLogEntry>('message-logs', key);
    if (!persisted) {
      return null;
    }
    if (this.isExpired(persisted.updatedAt, cacheConfig.ttlSeconds)) {
      return null;
    }

    this.runtimeMessageHistory.set(key, persisted);
    return persisted;
  }

  private isExpired(updatedAt: string, ttlSeconds: number): boolean {
    if (ttlSeconds <= 0) {
      return true;
    }
    const ageSeconds = (Date.now() - new Date(updatedAt).getTime()) / 1000;
    return ageSeconds > ttlSeconds;
  }
}
