import type {
  BookmarkRecord,
  PhoneNumberDetail,
  PhoneNumberSummary,
  CallLogEntry,
  CallDetail,
  CallRecording,
  CallEvent,
  CallNotification,
  MessageLogEntry,
  UpdateWebhooksRequest,
} from './models.js';

// ── Extension → Webview ───────────────────────────────────────────────────────

export type ExtensionToWebviewMessage =
  | { type: 'bookmarkLoaded';    bookmark: BookmarkRecord; subaccountName: string }
  | { type: 'phoneDetailLoaded'; detail: PhoneNumberDetail }
  | { type: 'callLogsLoaded';    entries: CallLogEntry[] }
  | { type: 'smsLogsLoaded';     entries: MessageLogEntry[] }
  | { type: 'callDetailLoaded';  detail: CallDetail; recordings: CallRecording[]; events: CallEvent[]; notifications: CallNotification[] }
  | { type: 'webhookSaved' }
  | { type: 'labelSaved' }
  | { type: 'tagsSaved' }
  | { type: 'error';             message: string; context?: string }
  | { type: 'locked' }
  | { type: 'numbersLoaded';     numbers: PhoneNumberSummary[]; bookmarkedSids: Record<string, string> }
  | { type: 'bookmarkAdded';     bookmarkId: string };

// ── Webview → Extension ───────────────────────────────────────────────────────

export type WebviewToExtensionMessage =
  | { type: 'ready' }
  | { type: 'updateLabel';    label: string; notes?: string }
  | { type: 'updateTags';     tags: string[] }
  | { type: 'saveWebhooks';   request: UpdateWebhooksRequest }
  | { type: 'loadCallLogs' }
  | { type: 'refreshCallLogs' }
  | { type: 'loadSmsLogs' }
  | { type: 'refreshSmsLogs' }
  | { type: 'loadCallDetail'; callSid: string }
  | { type: 'playRecording';  recordingSid: string; accountSid?: string }
  | { type: 'addBookmark';    phoneNumberSid: string; phoneNumber: string; label: string; tags: string[] }
  | { type: 'refreshNumbers' };
