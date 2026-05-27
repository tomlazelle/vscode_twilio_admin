import * as vscode from 'vscode';
import type { CallLogEntry, LogHistoryRecord, LogPageResult, MessageLogEntry } from '../types/models.js';
import type { TwilioService } from './twilioService.js';
import type { FileStore } from '../store/fileStore.js';

interface GetLogsOptions {
  forceRefresh?: boolean;
  loadMore?: boolean;
}

export class LogsService {
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

    if (forceRefresh) {
      await this.fileStore.clearLogHistory('call-logs', key);
    }

    const existing = await this.fileStore.readLogHistory<CallLogEntry>('call-logs', key);

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
    const mergedEntries = this.sortCallLogs([...(forceRefresh ? [] : (existing?.entries ?? [])), ...page.entries]);
    const record: LogHistoryRecord<CallLogEntry> = {
      version: 1,
      kind: 'call-logs',
      key,
      entries: mergedEntries,
      hasMore: page.hasMore,
      nextPageUrls: page.nextPageUrls,
      updatedAt: page.updatedAt,
    };

    await this.fileStore.writeLogHistory('call-logs', key, record);

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

    if (forceRefresh) {
      await this.fileStore.clearLogHistory('message-logs', key);
    }

    const existing = await this.fileStore.readLogHistory<MessageLogEntry>('message-logs', key);

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
    const mergedEntries = this.sortMessageLogs([...(forceRefresh ? [] : (existing?.entries ?? [])), ...page.entries]);
    const record: LogHistoryRecord<MessageLogEntry> = {
      version: 1,
      kind: 'message-logs',
      key,
      entries: mergedEntries,
      hasMore: page.hasMore,
      nextPageUrls: page.nextPageUrls,
      updatedAt: page.updatedAt,
    };

    await this.fileStore.writeLogHistory('message-logs', key, record);

    return {
      entries: record.entries,
      hasMore: record.hasMore,
      nextPageUrls: record.nextPageUrls,
      updatedAt: record.updatedAt,
    };
  }

  private sortCallLogs(entries: CallLogEntry[]): CallLogEntry[] {
    const deduped = new Map<string, CallLogEntry>();
    for (const entry of entries) {
      deduped.set(entry.sid, entry);
    }
    return Array.from(deduped.values()).sort((left, right) => {
      const leftTime = left.startTime ? new Date(left.startTime).getTime() : Number.NEGATIVE_INFINITY;
      const rightTime = right.startTime ? new Date(right.startTime).getTime() : Number.NEGATIVE_INFINITY;
      if (rightTime !== leftTime) {
        return rightTime - leftTime;
      }
      return right.sid.localeCompare(left.sid);
    });
  }

  private sortMessageLogs(entries: MessageLogEntry[]): MessageLogEntry[] {
    const deduped = new Map<string, MessageLogEntry>();
    for (const entry of entries) {
      deduped.set(entry.sid, entry);
    }
    return Array.from(deduped.values()).sort((left, right) => {
      const leftTime = left.dateSent ? new Date(left.dateSent).getTime() : Number.NEGATIVE_INFINITY;
      const rightTime = right.dateSent ? new Date(right.dateSent).getTime() : Number.NEGATIVE_INFINITY;
      if (rightTime !== leftTime) {
        return rightTime - leftTime;
      }
      return right.sid.localeCompare(left.sid);
    });
  }
}
