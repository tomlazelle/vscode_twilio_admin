import * as vscode from 'vscode';
import type { CallLogEntry, MessageLogEntry } from '../types/models.js';
import type { TwilioService } from './twilioService.js';
import type { FileStore } from '../store/fileStore.js';

export class LogsService {
  constructor(
    private readonly twilioService: TwilioService,
    private readonly fileStore: FileStore
  ) {}

  async getCallLogs(
    subaccountId: string,
    phoneNumber: string,
    forceRefresh = false,
    token?: vscode.CancellationToken
  ): Promise<CallLogEntry[]> {
    const config = vscode.workspace.getConfiguration('twilioAdmin');
    const cacheEnabled = config.get<boolean>('cache.enabled') ?? true;
    const ttl = config.get<number>('cache.ttlSeconds') ?? 120;
    const limit = config.get<number>('logs.pageSize') ?? 50;
    const key = `${subaccountId}:${phoneNumber}`;

    if (cacheEnabled && !forceRefresh) {
      const cached = await this.fileStore.readCacheEntry<CallLogEntry[]>('call-logs', key, ttl);
      if (cached) {
        return cached;
      }
    }

    const entries = await this.twilioService.getCallLogs(subaccountId, phoneNumber, limit, token);

    if (cacheEnabled) {
      await this.fileStore.writeCacheEntry('call-logs', key, entries);
    }

    return entries;
  }

  async getMessageLogs(
    subaccountId: string,
    phoneNumber: string,
    forceRefresh = false,
    token?: vscode.CancellationToken
  ): Promise<MessageLogEntry[]> {
    const config = vscode.workspace.getConfiguration('twilioAdmin');
    const cacheEnabled = config.get<boolean>('cache.enabled') ?? true;
    const ttl = config.get<number>('cache.ttlSeconds') ?? 120;
    const limit = config.get<number>('logs.pageSize') ?? 50;
    const key = `${subaccountId}:${phoneNumber}`;

    if (cacheEnabled && !forceRefresh) {
      const cached = await this.fileStore.readCacheEntry<MessageLogEntry[]>('message-logs', key, ttl);
      if (cached) {
        return cached;
      }
    }

    const entries = await this.twilioService.getMessageLogs(subaccountId, phoneNumber, limit, token);

    if (cacheEnabled) {
      await this.fileStore.writeCacheEntry('message-logs', key, entries);
    }

    return entries;
  }
}
