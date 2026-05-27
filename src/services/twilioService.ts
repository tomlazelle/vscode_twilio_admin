import * as vscode from 'vscode';
import type {
  PhoneNumberSummary,
  PhoneNumberDetail,
  UpdateWebhooksRequest,
  CallLogEntry,
  CallDetail,
  CallRecording,
  CallEvent,
  CallEventParameter,
  CallNotification,
  MessageLogEntry,
  LogPageResult,
} from '../types/models.js';
import type { SubaccountService } from './subaccountService.js';
import type { Logger } from '../util/logger.js';

// Loaded lazily to avoid startup cost
let twilioModule: typeof import('twilio') | undefined;
async function getTwilio(): Promise<typeof import('twilio')> {
  if (!twilioModule) {
    twilioModule = await import('twilio');
  }
  return twilioModule;
}

export class TwilioApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly code?: number
  ) {
    super(message);
    this.name = 'TwilioApiError';
  }
}

export class TwilioService {
  constructor(
    private readonly subaccountService: SubaccountService,
    private readonly logger: Logger
  ) {}

  async listNumbers(
    subaccountId: string,
    token?: vscode.CancellationToken
  ): Promise<PhoneNumberSummary[]> {
    const client = await this.createClient(subaccountId);
    this.checkCancelled(token);

    try {
      const numbers = await client.incomingPhoneNumbers.list({ limit: 1000 });
      this.checkCancelled(token);

      return numbers.map(n => ({
        sid: n.sid,
        phoneNumber: n.phoneNumber,
        friendlyName: n.friendlyName,
        voiceUrl: n.voiceUrl || undefined,
        smsUrl: n.smsUrl || undefined,
        capabilities: {
          voice: n.capabilities?.voice ?? false,
          sms: n.capabilities?.sms ?? false,
          mms: n.capabilities?.mms ?? false,
        },
      }));
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async getNumber(
    subaccountId: string,
    phoneNumberSid: string,
    token?: vscode.CancellationToken
  ): Promise<PhoneNumberDetail> {
    const client = await this.createClient(subaccountId);
    this.checkCancelled(token);

    try {
      const n = await client.incomingPhoneNumbers(phoneNumberSid).fetch();
      this.checkCancelled(token);

      return {
        sid: n.sid,
        phoneNumber: n.phoneNumber,
        friendlyName: n.friendlyName,
        voiceUrl: n.voiceUrl || undefined,
        voiceMethod: this.normalizeMethod(n.voiceMethod),
        smsUrl: n.smsUrl || undefined,
        smsMethod: this.normalizeMethod(n.smsMethod),
        statusCallback: n.statusCallback || undefined,
        statusCallbackMethod: this.normalizeMethod(n.statusCallbackMethod),
        capabilities: {
          voice: n.capabilities?.voice ?? false,
          sms: n.capabilities?.sms ?? false,
          mms: n.capabilities?.mms ?? false,
        },
      };
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async updateWebhooks(
    subaccountId: string,
    phoneNumberSid: string,
    request: UpdateWebhooksRequest,
    token?: vscode.CancellationToken
  ): Promise<void> {
    const client = await this.createClient(subaccountId);
    this.checkCancelled(token);

    try {
      await client.incomingPhoneNumbers(phoneNumberSid).update({
        voiceUrl: request.voiceUrl || null,
        voiceMethod: request.voiceMethod,
        smsUrl: request.smsUrl || null,
        smsMethod: request.smsMethod,
        statusCallback: request.statusCallback || null,
        statusCallbackMethod: request.statusCallbackMethod,
      } as Parameters<ReturnType<typeof client.incomingPhoneNumbers>['update']>[0]);
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async getCallLogs(
    subaccountId: string,
    phoneNumber: string,
    limit: number,
    token?: vscode.CancellationToken
  ): Promise<CallLogEntry[]> {
    const page = await this.getCallLogsPage(subaccountId, phoneNumber, limit, undefined, token);
    return page.entries;
  }

  async getCallLogsPage(
    subaccountId: string,
    phoneNumber: string,
    pageSize: number,
    nextPageUrls?: { to?: string; from?: string },
    token?: vscode.CancellationToken
  ): Promise<LogPageResult<CallLogEntry>> {
    const client = await this.createClient(subaccountId);
    this.checkCancelled(token);

    try {
      const [toPage, fromPage] = await Promise.all([
        this.fetchCallDirectionPage(client, phoneNumber, pageSize, 'to', nextPageUrls?.to),
        this.fetchCallDirectionPage(client, phoneNumber, pageSize, 'from', nextPageUrls?.from),
      ]);
      this.checkCancelled(token);

      const callMap = new Map<string, CallLogEntry>();
      for (const call of [...toPage.entries, ...fromPage.entries]) {
        callMap.set(call.sid, call);
      }

      await this.collectTransferredCallLegs(client, Array.from(callMap.keys()), callMap, pageSize, token);

      return {
        entries: this.sortCallEntries(Array.from(callMap.values())),
        hasMore: Boolean(toPage.nextPageUrl || fromPage.nextPageUrl),
        nextPageUrls: {
          to: toPage.nextPageUrl,
          from: fromPage.nextPageUrl,
        },
        updatedAt: new Date().toISOString(),
      };
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async getMessageLogs(
    subaccountId: string,
    phoneNumber: string,
    limit: number,
    token?: vscode.CancellationToken
  ): Promise<MessageLogEntry[]> {
    const page = await this.getMessageLogsPage(subaccountId, phoneNumber, limit, undefined, token);
    return page.entries;
  }

  async getMessageLogsPage(
    subaccountId: string,
    phoneNumber: string,
    pageSize: number,
    nextPageUrls?: { to?: string; from?: string },
    token?: vscode.CancellationToken
  ): Promise<LogPageResult<MessageLogEntry>> {
    const client = await this.createClient(subaccountId);
    this.checkCancelled(token);

    try {
      const [toPage, fromPage] = await Promise.all([
        this.fetchMessageDirectionPage(client, phoneNumber, pageSize, 'to', nextPageUrls?.to),
        this.fetchMessageDirectionPage(client, phoneNumber, pageSize, 'from', nextPageUrls?.from),
      ]);
      this.checkCancelled(token);

      const entries = this.sortMessageEntries([
        ...toPage.entries,
        ...fromPage.entries,
      ]);
      return {
        entries,
        hasMore: Boolean(toPage.nextPageUrl || fromPage.nextPageUrl),
        nextPageUrls: {
          to: toPage.nextPageUrl,
          from: fromPage.nextPageUrl,
        },
        updatedAt: new Date().toISOString(),
      };
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async getCallDetail(
    subaccountId: string,
    callSid: string,
    token?: vscode.CancellationToken
  ): Promise<CallDetail> {
    const client = await this.createClient(subaccountId);
    this.checkCancelled(token);

    try {
      const c = await client.calls(callSid).fetch();
      this.checkCancelled(token);

      return {
        sid: c.sid,
        from: c.from,
        to: c.to,
        direction: c.direction,
        status: c.status,
        startTime: c.startTime?.toISOString(),
        endTime: c.endTime?.toISOString(),
        duration: c.duration ? parseInt(String(c.duration), 10) : undefined,
        price: c.price || undefined,
        priceUnit: c.priceUnit || undefined,
        answeredBy: c.answeredBy || undefined,
        callerName: c.callerName || undefined,
        forwardedFrom: c.forwardedFrom || undefined,
        parentCallSid: c.parentCallSid || undefined,
        queueTime: c.queueTime || undefined,
        errorCode: c.errorCode || undefined,
        errorMessage: c.errorMessage || undefined,
      };
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async getCallRecordings(
    subaccountId: string,
    callSid: string,
    token?: vscode.CancellationToken
  ): Promise<CallRecording[]> {
    const client = await this.createClient(subaccountId);
    this.checkCancelled(token);

    try {
      const recordings = await client.calls(callSid).recordings.list();
      this.checkCancelled(token);

      return recordings.map(r => ({
        sid: r.sid,
        duration: r.duration ? parseInt(String(r.duration), 10) : undefined,
        startTime: r.startTime?.toISOString(),
        price: r.price || undefined,
        priceUnit: r.priceUnit || undefined,
      }));
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async getCallEvents(
    subaccountId: string,
    callSid: string,
    token?: vscode.CancellationToken
  ): Promise<CallEvent[]> {
    const account = await this.subaccountService.getById(subaccountId);
    if (!account) {
      throw new Error(`Subaccount ${subaccountId} not found`);
    }
    const authToken = await this.subaccountService.getCredential(subaccountId);
    this.checkCancelled(token);

    const url = `https://api.twilio.com/2010-04-01/Accounts/${account.accountSid}/Calls/${callSid}/Events.json`;
    const credentials = Buffer.from(`${account.accountSid}:${authToken}`).toString('base64');

    try {
      const { default: https } = await import('https');
      const data = await new Promise<string>((resolve, reject) => {
        https.get(url, { headers: { Authorization: `Basic ${credentials}` } }, res => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
          res.on('error', reject);
        }).on('error', reject);
      });

      const parsed = JSON.parse(data) as { events?: unknown[] };
      const events = parsed.events ?? [];

      return (events as Record<string, unknown>[]).map(e => {
        const req = e['request'] as Record<string, unknown> | undefined;
        const res = e['response'] as Record<string, unknown> | undefined;

        // Parameters may be an array [{name, value}] or an object {key: value}
        let requestParameters: CallEventParameter[] = [];
        if (req) {
          const rawParams = req['parameters'];
          if (Array.isArray(rawParams)) {
            requestParameters = (rawParams as Record<string, unknown>[]).map(p => ({
              name: String(p['name'] ?? ''),
              value: String(p['value'] ?? ''),
            }));
          } else if (rawParams && typeof rawParams === 'object') {
            requestParameters = Object.entries(rawParams as Record<string, unknown>).map(([name, value]) => ({
              name,
              value: String(value ?? ''),
            }));
          }
        }

        let responseContent: string | undefined;
        if (res) {
          const body = res['body'] ?? res['content'];
          if (body !== undefined && body !== null) {
            responseContent = typeof body === 'string' ? body : JSON.stringify(body, null, 2);
          } else {
            responseContent = JSON.stringify(res, null, 2);
          }
        }

        return {
          requestMethod: String(req?.['method'] ?? ''),
          requestUrl: String(req?.['url'] ?? ''),
          requestParameters,
          responseStatusCode: Number(res?.['statusCode'] ?? res?.['status_code'] ?? 0) || undefined,
          responseContent,
        };
      });
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async getCallNotifications(
    subaccountId: string,
    callSid: string,
    token?: vscode.CancellationToken
  ): Promise<CallNotification[]> {
    const client = await this.createClient(subaccountId);
    this.checkCancelled(token);

    try {
      const notifications = await client.calls(callSid).notifications.list({ limit: 100 });
      this.checkCancelled(token);

      return notifications.map((n: Record<string, unknown>) => ({
        sid: String(n['sid'] ?? ''),
        // Twilio notification objects commonly use `log`; keep this in logLevel for UI filtering.
        logLevel: String(n['logLevel'] ?? n['log_level'] ?? n['log'] ?? ''),
        errorCode: Number(n['errorCode'] ?? n['error_code'] ?? 0) || undefined,
        messageText: String(n['messageText'] ?? n['message_text'] ?? ''),
        messageDate: String(n['messageDate'] ?? n['message_date'] ?? n['dateCreated'] ?? n['date_created'] ?? ''),
        moreInfo: String(n['moreInfo'] ?? n['more_info'] ?? ''),
        requestUrl: String(n['requestUrl'] ?? n['request_url'] ?? ''),
      }));
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  private async createClient(subaccountId: string) {
    const account = await this.subaccountService.getById(subaccountId);
    if (!account) {
      throw new Error(`Subaccount ${subaccountId} not found`);
    }
    const authToken = await this.subaccountService.getCredential(subaccountId);
    const twilio = await getTwilio();
    return twilio.default(account.accountSid, authToken);
  }

  private normalizeMethod(method: string | undefined): 'GET' | 'POST' {
    return method?.toUpperCase() === 'GET' ? 'GET' : 'POST';
  }

  private mapCallEntry(c: {
    sid: string;
    from?: string;
    to?: string;
    direction?: string;
    status?: string;
    startTime?: Date | string | null;
    duration?: number | string | null;
  }): CallLogEntry {
    return {
      sid: c.sid,
      from: c.from ?? '',
      to: c.to ?? '',
      direction: c.direction ?? '',
      status: c.status ?? '',
      startTime: c.startTime ? new Date(c.startTime).toISOString() : undefined,
      duration: c.duration ? parseInt(String(c.duration), 10) : undefined,
    };
  }

  private mapMessageEntry(m: {
    sid: string;
    from?: string;
    to?: string;
    direction?: string;
    status?: string;
    dateSent?: Date | string | null;
    body?: string | null;
  }): MessageLogEntry {
    return {
      sid: m.sid,
      from: m.from ?? '',
      to: m.to ?? '',
      direction: m.direction ?? '',
      status: m.status ?? '',
      dateSent: m.dateSent ? new Date(m.dateSent).toISOString() : undefined,
      body: m.body ? m.body.slice(0, 120) : undefined,
    };
  }

  private async fetchCallDirectionPage(
    client: Awaited<ReturnType<typeof this.createClient>>,
    phoneNumber: string,
    pageSize: number,
    direction: 'to' | 'from',
    pageUrl?: string
  ): Promise<{ entries: CallLogEntry[]; nextPageUrl?: string }> {
    const page = pageUrl
      ? await client.calls.getPage(pageUrl)
      : await client.calls.page({
        [direction]: phoneNumber,
        pageSize,
      } as Parameters<typeof client.calls.page>[0]);

    return {
      entries: page.instances.map(call => this.mapCallEntry(call)),
      nextPageUrl: page.nextPageUrl,
    };
  }

  private async fetchMessageDirectionPage(
    client: Awaited<ReturnType<typeof this.createClient>>,
    phoneNumber: string,
    pageSize: number,
    direction: 'to' | 'from',
    pageUrl?: string
  ): Promise<{ entries: MessageLogEntry[]; nextPageUrl?: string }> {
    const page = pageUrl
      ? await client.messages.getPage(pageUrl)
      : await client.messages.page({
        [direction]: phoneNumber,
        pageSize,
      } as Parameters<typeof client.messages.page>[0]);

    return {
      entries: page.instances.map(message => this.mapMessageEntry(message)),
      nextPageUrl: page.nextPageUrl,
    };
  }

  private sortCallEntries(entries: CallLogEntry[]): CallLogEntry[] {
    return entries.sort((left, right) => {
      const leftTime = left.startTime ? new Date(left.startTime).getTime() : Number.NEGATIVE_INFINITY;
      const rightTime = right.startTime ? new Date(right.startTime).getTime() : Number.NEGATIVE_INFINITY;
      if (rightTime !== leftTime) {
        return rightTime - leftTime;
      }
      return right.sid.localeCompare(left.sid);
    });
  }

  private sortMessageEntries(entries: MessageLogEntry[]): MessageLogEntry[] {
    return entries.sort((left, right) => {
      const leftTime = left.dateSent ? new Date(left.dateSent).getTime() : Number.NEGATIVE_INFINITY;
      const rightTime = right.dateSent ? new Date(right.dateSent).getTime() : Number.NEGATIVE_INFINITY;
      if (rightTime !== leftTime) {
        return rightTime - leftTime;
      }
      return right.sid.localeCompare(left.sid);
    });
  }

  private async collectTransferredCallLegs(
    client: Awaited<ReturnType<typeof this.createClient>>,
    parentSids: string[],
    callMap: Map<string, CallLogEntry>,
    pageSize: number,
    token?: vscode.CancellationToken
  ): Promise<void> {
    const visitedParents = new Set<string>();
    const queue = [...parentSids];

    while (queue.length > 0) {
      this.checkCancelled(token);
      const parentSid = queue.shift();
      if (!parentSid || visitedParents.has(parentSid)) {
        continue;
      }
      visitedParents.add(parentSid);

      let page = await client.calls.page({ parentCallSid: parentSid, pageSize });
      while (true) {
        this.checkCancelled(token);
        for (const call of page.instances) {
          if (callMap.has(call.sid)) {
            continue;
          }
          const entry = this.mapCallEntry(call);
          callMap.set(entry.sid, entry);
          queue.push(entry.sid);
        }
        if (!page.nextPageUrl) {
          break;
        }
        const nextPage = await page.nextPage();
        if (!nextPage) {
          break;
        }
        page = nextPage;
      }
    }
  }

  private checkCancelled(token?: vscode.CancellationToken): void {
    if (token?.isCancellationRequested) {
      throw new vscode.CancellationError();
    }
  }

  private wrapError(err: unknown): TwilioApiError {
    if (err instanceof vscode.CancellationError) {
      throw err;
    }
    if (err instanceof TwilioApiError) {
      return err;
    }
    const e = err as Record<string, unknown>;
    const status = Number(e['status'] ?? e['statusCode'] ?? 0) || undefined;
    const code = Number(e['code'] ?? 0) || undefined;
    const message = String(e['message'] ?? 'Twilio API error');

    if (status === 401) {
      return new TwilioApiError('Invalid Twilio credentials. Please check your auth token.', status, code);
    }
    if (status === 429) {
      return new TwilioApiError('Twilio rate limit exceeded. Please try again shortly.', status, code);
    }
    this.logger.error('Twilio API error', err);
    return new TwilioApiError(message, status, code);
  }
}
