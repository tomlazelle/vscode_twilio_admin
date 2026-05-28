import { describe, it, expect, vi } from 'vitest';
import { TwilioService } from '../../src/services/twilioService.js';
import type { Logger } from '../../src/util/logger.js';

function makeLogger(): Logger {
  return {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  } as unknown as Logger;
}

describe('TwilioService paging', () => {
  it('treats missing cursor keys as exhausted directions during loadMore', async () => {
    const callsPage = vi.fn(async () => ({
      instances: [
        { sid: 'CA-UNEXPECTED', from: '+1', to: '+2', direction: 'outbound-api', status: 'completed', startTime: new Date('2025-01-02T10:00:00.000Z') },
      ],
      nextPageUrl: undefined,
    }));
    const callsGetPage = vi.fn(async () => ({
      instances: [],
      nextPageUrl: undefined,
    }));
    const mockClient = {
      calls: {
        page: callsPage,
        getPage: callsGetPage,
      },
      messages: {
        page: vi.fn(),
        getPage: vi.fn(),
      },
    } as any;

    const service = new TwilioService({} as any, makeLogger());
    (service as any).createClient = vi.fn(async () => mockClient);

    const result = await service.getCallLogsPage('sub-1', '+15005550001', 50, {});

    expect(callsGetPage).not.toHaveBeenCalled();
    expect(callsPage).not.toHaveBeenCalled();
    expect(result.entries).toEqual([]);
    expect(result.hasMore).toBe(false);
    expect(result.nextPageUrls).toEqual({ to: undefined, from: undefined });
  });

  it('does not re-fetch page 1 for an exhausted direction during loadMore', async () => {
    const callsPage = vi.fn(async () => ({
      instances: [],
      nextPageUrl: undefined,
    }));
    const callsGetPage = vi.fn(async () => ({
      instances: [
        { sid: 'CA2', from: '+1', to: '+2', direction: 'outbound-api', status: 'completed', startTime: new Date('2025-01-02T10:00:00.000Z') },
      ],
      nextPageUrl: undefined,
    }));
    const mockClient = {
      calls: {
        page: callsPage,
        getPage: callsGetPage,
      },
      messages: {
        page: vi.fn(),
        getPage: vi.fn(),
      },
    } as any;

    const service = new TwilioService({} as any, makeLogger());
    (service as any).createClient = vi.fn(async () => mockClient);

    const result = await service.getCallLogsPage('sub-1', '+15005550001', 50, { from: 'next-from' });

    expect(callsGetPage).toHaveBeenCalledWith('next-from');
    expect(callsPage).toHaveBeenCalledTimes(1);
    expect(callsPage.mock.calls[0][0]).toEqual({ parentCallSid: 'CA2', pageSize: 50 });
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].sid).toBe('CA2');
  });

  it('deduplicates message entries before returning a page', async () => {
    const messagesPage = vi.fn(async (opts: { to?: string; from?: string }) => {
      if (opts.to) {
        return {
          instances: [
            { sid: 'SM1', from: '+1', to: '+2', direction: 'outbound-api', status: 'sent', dateSent: new Date('2025-01-02T10:00:00.000Z') },
          ],
          nextPageUrl: undefined,
        };
      }
      return {
        instances: [
          { sid: 'SM1', from: '+1', to: '+2', direction: 'outbound-api', status: 'sent', dateSent: new Date('2025-01-02T10:00:00.000Z') },
        ],
        nextPageUrl: undefined,
      };
    });
    const mockClient = {
      calls: {
        page: vi.fn(),
        getPage: vi.fn(),
      },
      messages: {
        page: messagesPage,
        getPage: vi.fn(),
      },
    } as any;

    const service = new TwilioService({} as any, makeLogger());
    (service as any).createClient = vi.fn(async () => mockClient);

    const result = await service.getMessageLogsPage('sub-1', '+15005550001', 50);

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].sid).toBe('SM1');
  });
});
