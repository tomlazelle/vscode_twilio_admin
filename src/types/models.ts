// ── Persisted records (written to JSON files) ────────────────────────────────

export interface SubaccountRecord {
  id: string;
  friendlyName: string;
  accountSid: string;
  createdAt: string;
  updatedAt: string;
}

export interface BookmarkRecord {
  id: string;
  subaccountId: string;
  phoneNumberSid: string;
  phoneNumber: string;
  label: string;
  notes?: string;
  tags: string[];
  createdAt: string;
  updatedAt?: string;
}

export interface PreferencesRecord {
  activeTagFilter: string | null;
  lastSelectedSubaccountId: string | null;
  recentBookmarkIds: string[];
}

// ── Encrypted credential storage ─────────────────────────────────────────────

export interface EncryptedCredentialEntry {
  subaccountId: string;
  ciphertext: string;
  iv: string;
  authTag: string;
  dataKeyEncrypted: string;
  dataKeyIv: string;
  dataKeyAuthTag: string;
  version: number;
}

export interface CredentialStore {
  version: number;
  entries: EncryptedCredentialEntry[];
}

export interface EncryptionMetadata {
  masterKeyRef: string;
  kdfSalt?: string;
  kdfIterations?: number;
  createdAt: string;
}

// ── Twilio API surface models ─────────────────────────────────────────────────

export interface PhoneNumberCapabilities {
  voice: boolean;
  sms: boolean;
  mms: boolean;
}

export interface PhoneNumberSummary {
  sid: string;
  phoneNumber: string;
  friendlyName: string;
  voiceUrl?: string;
  smsUrl?: string;
  capabilities: PhoneNumberCapabilities;
}

export interface PhoneNumberDetail extends PhoneNumberSummary {
  voiceMethod: 'GET' | 'POST';
  smsMethod: 'GET' | 'POST';
  statusCallback?: string;
  statusCallbackMethod: 'GET' | 'POST';
}

export interface UpdateWebhooksRequest {
  voiceUrl?: string;
  voiceMethod: 'GET' | 'POST';
  smsUrl?: string;
  smsMethod: 'GET' | 'POST';
  statusCallback?: string;
  statusCallbackMethod: 'GET' | 'POST';
}

export interface CallLogEntry {
  sid: string;
  from: string;
  to: string;
  direction: string;
  status: string;
  startTime?: string;
  duration?: number;
}

export interface CallDetail extends CallLogEntry {
  endTime?: string;
  price?: string;
  priceUnit?: string;
  answeredBy?: string;
  callerName?: string;
  forwardedFrom?: string;
  parentCallSid?: string;
  queueTime?: string;
  errorCode?: number;
  errorMessage?: string;
}

export interface CallRecording {
  sid: string;
  duration?: number;
  startTime?: string;
  track?: string;
  channels?: number;
  price?: string;
  priceUnit?: string;
}

export interface CallEventParameter {
  name: string;
  value: string;
}

export interface CallEvent {
  requestMethod?: string;
  requestUrl?: string;
  requestParameters: CallEventParameter[];
  responseStatusCode?: number;
  responseContent?: string;
}

export interface CallNotification {
  sid: string;
  logLevel?: string;
  errorCode?: number;
  messageText?: string;
  messageDate?: string;
  moreInfo?: string;
  requestUrl?: string;
}

export interface MessageLogEntry {
  sid: string;
  from: string;
  to: string;
  direction: string;
  status: string;
  dateSent?: string;
  body?: string;
}

export interface LogPageResult<T> {
  entries: T[];
  hasMore: boolean;
  nextPageUrls?: {
    to?: string;
    from?: string;
  };
  updatedAt: string;
}

export interface LogHistoryRecord<T> {
  version: 1;
  kind: 'call-logs' | 'message-logs';
  key: string;
  entries: T[];
  hasMore: boolean;
  nextPageUrls?: {
    to?: string;
    from?: string;
  };
  updatedAt: string;
}

// ── Cache ─────────────────────────────────────────────────────────────────────

export interface CacheEntry<T = unknown> {
  cachedAt: string;
  data: T;
}

// ── Service container (passed to commands and panels) ────────────────────────

export interface ServiceContainer {
  subaccountService: import('../services/subaccountService.js').SubaccountService;
  bookmarkService: import('../services/bookmarkService.js').BookmarkService;
  twilioService: import('../services/twilioService.js').TwilioService;
  logsService: import('../services/logsService.js').LogsService;
  secretStore: import('../store/secretStore.js').SecretStore;
  logger: import('../util/logger.js').Logger;
}
