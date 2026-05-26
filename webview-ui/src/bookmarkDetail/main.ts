import type { ExtensionToWebviewMessage } from '../../../src/types/messages.js';
import type {
  BookmarkRecord,
  CallLogEntry,
  CallDetail,
  CallRecording,
  CallEvent,
  CallNotification,
  MessageLogEntry,
  PhoneNumberDetail,
  UpdateWebhooksRequest,
} from '../../../src/types/models.js';

declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();

// ── State ─────────────────────────────────────────────────────────────────────

let bookmark: BookmarkRecord | null = null;
let subaccountName = '';
let phoneDetail: PhoneNumberDetail | null = null;
let callLogs: CallLogEntry[] = [];
let smsLogs: MessageLogEntry[] = [];
let activeTab: 'calls' | 'sms' = 'calls';
let callLogsLoaded = false;
let smsLogsLoaded = false;
let callLogsLoading = false;
let smsLogsLoading = false;

// Call detail panel
let selectedCall: CallDetail | null = null;
let callRecordings: CallRecording[] = [];
let callEvents: CallEvent[] = [];
let callNotifications: CallNotification[] = [];
let callDetailLoading = false;
let callDetailPanelOpen = false;
let mainColScrollTop = 0;

// Webhook form
let webhookEditing = false;
let webhookSaving = false;

// Tag editing
let tagInput = '';

// ── Utilities ─────────────────────────────────────────────────────────────────

function esc(s: string | null | undefined): string {
  if (!s) { return ''; }
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtDate(iso: string | undefined): string {
  if (!iso) { return '—'; }
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit',
    });
  } catch { return iso; }
}

function fmtDuration(secs: number | undefined): string {
  if (secs == null) { return '—'; }
  if (secs < 60) { return `${secs}s`; }
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function fmtPrice(price: string | undefined, unit: string | undefined): string {
  if (!price) { return '—'; }
  return unit ? `${price} ${unit}` : price;
}

function statusBadge(status: string | undefined): string {
  if (!status) { return ''; }
  const cls = /complet|answered/i.test(status) ? 'badge-green'
    : /busy|no-answer|failed|cancel/i.test(status) ? 'badge-red'
    : 'badge-neutral';
  return `<span class="badge ${cls}">${esc(status)}</span>`;
}

function methodBadge(method: string | undefined): string {
  if (!method) { return ''; }
  const cls = method.toUpperCase() === 'GET' ? 'badge-blue' : 'badge-purple';
  return `<span class="badge ${cls}">${esc(method.toUpperCase())}</span>`;
}

function httpStatusBadge(code: number | undefined): string {
  if (!code) { return ''; }
  const cls = code < 300 ? 'badge-green' : 'badge-red';
  return `<span class="badge ${cls}">${code}</span>`;
}

function directionIcon(dir: string | undefined): string {
  if (!dir) { return ''; }
  return dir.includes('inbound') ? '↙' : '↗';
}

function post(msg: unknown): void {
  vscode.postMessage(msg);
}

// ── Render: whole page ────────────────────────────────────────────────────────

function renderAll(): void {
  if (!bookmark) { return; }

  const app = document.getElementById('app');
  if (!app) { return; }

  const previousMainCol = app.querySelector<HTMLElement>('.main-col');
  if (previousMainCol) {
    mainColScrollTop = previousMainCol.scrollTop;
  }

  app.innerHTML = `
    <div class="layout ${callDetailPanelOpen ? 'panel-open' : ''}">
      <div class="main-col">
        ${renderHeader()}
        ${renderTags()}
        ${renderWebhooks()}
        ${renderTabs()}
        ${renderLogsPane()}
      </div>
      <div class="detail-col ${callDetailPanelOpen ? 'open' : ''}">
        ${renderCallDetailPanel()}
      </div>
    </div>
  `;

  const nextMainCol = app.querySelector<HTMLElement>('.main-col');
  if (nextMainCol) {
    nextMainCol.scrollTop = mainColScrollTop;
  }

  attachHandlers();
}

// ── Render: header ────────────────────────────────────────────────────────────

function renderHeader(): string {
  if (!bookmark) { return ''; }
  return `
    <div class="section header-section">
      <div class="header-top">
        <div class="header-label-wrap">
          <h1 id="label-display" class="page-title editable-label" title="Click to edit">${esc(bookmark.label)}</h1>
          <div id="label-edit-form" class="label-edit-form" style="display:none">
            <input id="label-input" type="text" class="label-input" value="${esc(bookmark.label)}">
            <button id="label-save" class="btn-small">Save</button>
            <button id="label-cancel" class="btn-small secondary">Cancel</button>
          </div>
        </div>
      </div>
      <div class="header-meta">
        <span class="meta-number">${esc(bookmark.phoneNumber)}</span>
        <span class="meta-sep">·</span>
        <span class="meta-account">${esc(subaccountName)}</span>
        ${bookmark.notes ? `<span class="meta-sep">·</span><span class="meta-notes">${esc(bookmark.notes)}</span>` : ''}
      </div>
    </div>
  `;
}

// ── Render: tags ──────────────────────────────────────────────────────────────

function renderTags(): string {
  if (!bookmark) { return ''; }
  const chips = bookmark.tags.map(t =>
    `<span class="tag-chip">${esc(t)}<button class="tag-remove" data-tag="${esc(t)}" aria-label="Remove ${esc(t)}">×</button></span>`
  ).join('');
  return `
    <div class="section tags-section">
      <div class="tags-row">
        ${chips}
        <div class="tag-add-wrap">
          <input id="tag-input" type="text" class="tag-input" placeholder="Add tag…" value="${esc(tagInput)}" maxlength="50">
        </div>
      </div>
    </div>
  `;
}

// ── Render: webhooks ──────────────────────────────────────────────────────────

function renderWebhooks(): string {
  const d = phoneDetail;
  if (!webhookEditing) {
    return `
      <div class="section webhooks-section">
        <div class="section-header">
          <h2 class="section-title">Webhooks</h2>
          <button id="webhook-edit-btn" class="btn-small">${d ? 'Edit' : 'Loading…'}</button>
        </div>
        ${d ? `
        <div class="config-grid">
          ${configRow('Voice URL',   d.voiceUrl    || '—', true)}
          ${configRow('Voice Method', d.voiceMethod)}
          ${configRow('SMS URL',     d.smsUrl      || '—', true)}
          ${configRow('SMS Method',  d.smsMethod)}
          ${configRow('Status Callback', d.statusCallback || '—', true)}
          ${configRow('Status Method',   d.statusCallbackMethod)}
        </div>` : '<p class="muted">Loading webhook configuration…</p>'}
      </div>
    `;
  }

  const v  = d?.voiceUrl             ?? '';
  const vm = d?.voiceMethod          ?? 'POST';
  const s  = d?.smsUrl               ?? '';
  const sm = d?.smsMethod            ?? 'POST';
  const sc = d?.statusCallback       ?? '';
  const scm = d?.statusCallbackMethod ?? 'POST';

  return `
    <div class="section webhooks-section">
      <div class="section-header">
        <h2 class="section-title">Webhooks</h2>
        <button id="webhook-cancel-btn" class="btn-small secondary">Cancel</button>
      </div>
      <form id="webhook-form" class="webhook-form">
        ${webhookField('voice-url',    'Voice URL',          v,   'voiceUrl',    'https://…')}
        ${methodSelect('voice-method', 'Voice Method',       vm,  'voiceMethod')}
        ${webhookField('sms-url',      'SMS URL',            s,   'smsUrl',      'https://…')}
        ${methodSelect('sms-method',   'SMS Method',         sm,  'smsMethod')}
        ${webhookField('status-cb',    'Status Callback',    sc,  'statusCallback', 'https://…')}
        ${methodSelect('status-method','Status Callback Method', scm, 'statusCallbackMethod')}
        <div class="form-actions">
          <button type="submit" id="webhook-save-btn" class="btn-primary" ${webhookSaving ? 'disabled' : ''}>
            ${webhookSaving ? 'Saving…' : 'Save Webhooks'}
          </button>
        </div>
      </form>
    </div>
  `;
}

function configRow(label: string, value: string, mono = false): string {
  return `
    <div class="config-row">
      <span class="config-label">${esc(label)}</span>
      <span class="config-value ${mono ? 'mono' : ''}">${esc(value)}</span>
    </div>
  `;
}

function webhookField(id: string, label: string, value: string, name: string, placeholder: string): string {
  return `
    <div class="form-field">
      <label for="${id}">${esc(label)}</label>
      <input id="${id}" type="url" name="${name}" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off">
    </div>
  `;
}

function methodSelect(id: string, label: string, value: string, name: string): string {
  return `
    <div class="form-field form-field-narrow">
      <label for="${id}">${esc(label)}</label>
      <select id="${id}" name="${name}">
        <option value="POST" ${value === 'POST' ? 'selected' : ''}>POST</option>
        <option value="GET"  ${value === 'GET'  ? 'selected' : ''}>GET</option>
      </select>
    </div>
  `;
}

// ── Render: tabs ──────────────────────────────────────────────────────────────

function renderTabs(): string {
  return `
    <div class="tabs">
      <button class="tab ${activeTab === 'calls' ? 'active' : ''}" data-tab="calls">Call Logs</button>
      <button class="tab ${activeTab === 'sms'   ? 'active' : ''}" data-tab="sms">SMS Logs</button>
    </div>
  `;
}

// ── Render: logs pane ─────────────────────────────────────────────────────────

function renderLogsPane(): string {
  if (activeTab === 'calls') {
    if (callLogsLoading) { return loadingState('Loading call logs…'); }
    if (!callLogsLoaded) {
      return `<div class="load-prompt"><button id="load-calls-btn" class="btn-small">Load Call Logs</button></div>`;
    }
    if (callLogs.length === 0) { return emptyState('No calls found for this number.'); }
    return renderCallLogsTable();
  } else {
    if (smsLogsLoading) { return loadingState('Loading SMS logs…'); }
    if (!smsLogsLoaded) {
      return `<div class="load-prompt"><button id="load-sms-btn" class="btn-small">Load SMS Logs</button></div>`;
    }
    if (smsLogs.length === 0) { return emptyState('No messages found for this number.'); }
    return renderSmsLogsTable();
  }
}

function renderCallLogsTable(): string {
  const rows = callLogs.map(c => {
    const isSelected = selectedCall?.sid === c.sid;
    return `<tr class="log-row ${isSelected ? 'selected' : ''}" data-sid="${esc(c.sid)}">
      <td class="col-date">${esc(fmtDate(c.startTime))}</td>
      <td class="col-from">${esc(c.from)}</td>
      <td class="col-to">${esc(c.to)}</td>
      <td class="col-dir">${directionIcon(c.direction)} ${esc(c.direction)}</td>
      <td class="col-status">${statusBadge(c.status)}</td>
      <td class="col-dur">${esc(fmtDuration(c.duration))}</td>
    </tr>`;
  }).join('');

  return `
    <div class="table-wrap">
      <table class="logs-table">
        <thead><tr>
          <th>Date</th><th>From</th><th>To</th><th>Direction</th><th>Status</th><th>Duration</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderSmsLogsTable(): string {
  const rows = smsLogs.map(m => `
    <tr class="log-row">
      <td class="col-date">${esc(fmtDate(m.dateSent))}</td>
      <td class="col-from">${esc(m.from)}</td>
      <td class="col-to">${esc(m.to)}</td>
      <td class="col-dir">${directionIcon(m.direction)} ${esc(m.direction)}</td>
      <td class="col-status">${statusBadge(m.status)}</td>
      <td class="col-body">${esc(m.body ?? '')}</td>
    </tr>`).join('');

  return `
    <div class="table-wrap">
      <table class="logs-table">
        <thead><tr>
          <th>Date</th><th>From</th><th>To</th><th>Direction</th><th>Status</th><th>Message</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function loadingState(msg: string): string {
  return `<div class="state-msg muted">${esc(msg)}</div>`;
}

function emptyState(msg: string): string {
  return `<div class="state-msg muted">${esc(msg)}</div>`;
}

// ── Render: call detail panel ─────────────────────────────────────────────────

function renderCallDetailPanel(): string {
  if (!callDetailPanelOpen) { return ''; }

  if (callDetailLoading) {
    return `
      <div class="detail-panel">
        <div class="detail-header">
          <button id="detail-close" class="btn-icon-sm" aria-label="Close">←</button>
          <span class="detail-title">Call Detail</span>
        </div>
        <div class="state-msg muted">Loading…</div>
      </div>`;
  }

  if (!selectedCall) { return ''; }
  const c = selectedCall;
  const warningFromNotifications = callNotifications.filter(n => classifyNotification(n) === 'warning');
  const warningFromEvents = callEvents
    .filter(e => (e.responseStatusCode ?? 0) >= 400 && (e.responseStatusCode ?? 0) < 500)
    .map((e, i) => ({
      sid: `event-warning-${i}`,
      logLevel: 'warning',
      errorCode: e.responseStatusCode,
      messageText: `Webhook response returned HTTP ${e.responseStatusCode}`,
      requestUrl: e.requestUrl,
    } satisfies CallNotification));
  const warnings = [...warningFromNotifications, ...warningFromEvents];

  const errorFromNotifications = callNotifications.filter(n => classifyNotification(n) === 'error');
  const errorFromEvents = callEvents
    .filter(e => (e.responseStatusCode ?? 0) >= 500)
    .map((e, i) => ({
      sid: `event-error-${i}`,
      logLevel: 'error',
      errorCode: e.responseStatusCode,
      messageText: `Webhook response returned HTTP ${e.responseStatusCode}`,
      requestUrl: e.requestUrl,
    } satisfies CallNotification));
  const errors = [
    ...(c.errorCode || c.errorMessage
      ? [{
        sid: `${c.sid}-call-error`,
        logLevel: 'error',
        errorCode: c.errorCode,
        messageText: c.errorMessage,
      } satisfies CallNotification]
      : []),
    ...errorFromNotifications,
    ...errorFromEvents,
  ];

  return `
    <div class="detail-panel">
      <div class="detail-header">
        <button id="detail-close" class="btn-icon-sm" aria-label="Close">←</button>
        <span class="detail-title">Call Detail</span>
      </div>
      <div class="detail-body">

        <div class="detail-sid">
          <span class="field-label">Call SID</span>
          <span class="field-value mono">${esc(c.sid)}</span>
        </div>

        <div class="detail-grid">
          ${detailField('From',      c.from)}
          ${detailField('To',        c.to)}
          ${detailField('Direction', c.direction)}
          ${detailFieldHtml('Status', statusBadge(c.status))}
          ${detailField('Start',     fmtDate(c.startTime))}
          ${detailField('End',       fmtDate(c.endTime))}
          ${detailField('Duration',  fmtDuration(c.duration))}
          ${detailField('Price',     fmtPrice(c.price, c.priceUnit))}
          ${c.callerName    ? detailField('Caller Name',    c.callerName)    : ''}
          ${c.answeredBy    ? detailField('Answered By',    c.answeredBy)    : ''}
          ${c.forwardedFrom ? detailField('Forwarded From', c.forwardedFrom) : ''}
          ${c.queueTime     ? detailField('Queue Time',     c.queueTime + 's') : ''}
          ${c.parentCallSid ? detailField('Parent Call',    c.parentCallSid, true) : ''}
        </div>

        ${renderRecordings()}
        ${renderIssues(errors, warnings)}
        ${renderEvents()}

      </div>
    </div>
  `;
}

function classifyNotification(notification: CallNotification): 'error' | 'warning' | 'info' {
  const rawLevel = (notification.logLevel ?? '').toString().trim().toLowerCase();
  if (/error|critical|fatal/.test(rawLevel)) { return 'error'; }
  if (/warn/.test(rawLevel)) { return 'warning'; }

  // Twilio Notification `log` is sometimes numeric-ish where higher values represent higher severity.
  const numericLevel = Number(rawLevel);
  if (!Number.isNaN(numericLevel)) {
    if (numericLevel >= 2) { return 'error'; }
    if (numericLevel >= 1) { return 'warning'; }
  }

  if ((notification.errorCode ?? 0) > 0) { return 'error'; }
  return 'info';
}

function renderIssues(errors: CallNotification[], warnings: CallNotification[]): string {
  return `
    <div class="detail-section">
      <h3 class="detail-section-title">Errors <span class="count-badge">${errors.length}</span></h3>
      ${errors.length === 0
        ? '<p class="muted small">No errors reported for this call.</p>'
        : errors.map(n => renderIssue(n, 'error')).join('')
      }

      <h3 class="detail-section-title" style="margin-top: 14px;">Warnings <span class="count-badge">${warnings.length}</span></h3>
      ${warnings.length === 0
        ? '<p class="muted small">No warnings reported for this call.</p>'
        : warnings.map(n => renderIssue(n, 'warning')).join('')
      }
    </div>
  `;
}

function renderIssue(notification: CallNotification, severity: 'error' | 'warning'): string {
  const sevClass = severity === 'error' ? 'badge-red' : 'badge-neutral';
  const title = notification.messageText?.trim() || 'Notification';
  const code = notification.errorCode ? `Code ${notification.errorCode}` : '';
  const timestamp = notification.messageDate ? fmtDate(notification.messageDate) : '';
  const requestUrl = notification.requestUrl?.trim();
  const moreInfo = notification.moreInfo?.trim();

  return `
    <div class="issue-card">
      <div class="issue-header">
        <span class="badge ${sevClass}">${severity.toUpperCase()}</span>
        ${code ? `<span class="muted small mono">${esc(code)}</span>` : ''}
        ${timestamp ? `<span class="muted small">${esc(timestamp)}</span>` : ''}
      </div>
      <div class="issue-message">${esc(title)}</div>
      ${requestUrl
        ? `<div class="issue-url mono muted"><a href="${esc(requestUrl)}" target="_blank" rel="noopener noreferrer">${esc(requestUrl)}</a></div>`
        : ''}
      ${moreInfo
        ? `<div class="issue-url mono muted"><a href="${esc(moreInfo)}" target="_blank" rel="noopener noreferrer">${esc(moreInfo)}</a></div>`
        : ''}
    </div>
  `;
}

function detailField(label: string, value: string | undefined, mono = false): string {
  return `
    <div class="detail-field">
      <span class="field-label">${esc(label)}</span>
      <span class="field-value ${mono ? 'mono' : ''}">${esc(value ?? '—')}</span>
    </div>
  `;
}

function detailFieldHtml(label: string, html: string): string {
  return `
    <div class="detail-field">
      <span class="field-label">${esc(label)}</span>
      <span class="field-value">${html}</span>
    </div>
  `;
}

// ── Render: recordings ────────────────────────────────────────────────────────

function renderRecordings(): string {
  return `
    <div class="detail-section">
      <h3 class="detail-section-title">Recordings <span class="count-badge">${callRecordings.length}</span></h3>
      ${callRecordings.length === 0
        ? '<p class="muted small">No recordings for this call.</p>'
        : callRecordings.map(r => renderRecording(r)).join('')
      }
    </div>
  `;
}

function renderRecording(r: CallRecording): string {
  return `
    <div class="recording-card">
      <div class="recording-meta">
        <span class="recording-info">
          ${r.track ? `<span class="tag-chip small">${esc(r.track)}</span>` : ''}
          ${r.duration != null ? `<span>${fmtDuration(r.duration)}</span>` : ''}
          ${r.startTime ? `<span class="muted">${esc(fmtDate(r.startTime))}</span>` : ''}
          ${r.price ? `<span class="muted">${esc(fmtPrice(r.price, r.priceUnit))}</span>` : ''}
        </span>
        <button class="btn-play" data-sid="${esc(r.sid)}" title="Open recording in external player">
          ▶ Play
        </button>
      </div>
      <div class="recording-sid mono muted">${esc(r.sid)}</div>
    </div>
  `;
}

// ── Render: events ────────────────────────────────────────────────────────────

function renderEvents(): string {
  return `
    <div class="detail-section">
      <h3 class="detail-section-title">Events <span class="count-badge">${callEvents.length}</span></h3>
      ${callEvents.length === 0
        ? '<p class="muted small">No events for this call.</p>'
        : callEvents.map((e, i) => renderEvent(e, i + 1)).join('')
      }
    </div>
  `;
}

function renderEvent(e: CallEvent, index: number): string {
  const paramsHtml = e.requestParameters.length > 0
    ? `<table class="params-table">
        ${e.requestParameters.map(p =>
          `<tr><td class="param-name mono">${esc(p.name)}</td><td class="param-value mono">${esc(p.value)}</td></tr>`
        ).join('')}
       </table>`
    : '<span class="muted small">No parameters</span>';

  const responseContent = e.responseContent
    ? `<pre class="response-body">${esc(e.responseContent)}</pre>`
    : '<span class="muted small">No response body</span>';

  return `
    <div class="event-card">
      <div class="event-number">${index}</div>
      <div class="event-content">
        <div class="event-request">
          <div class="event-url-row">
            ${methodBadge(e.requestMethod)}
            <span class="event-url mono">${esc(e.requestUrl ?? '')}</span>
          </div>
          <div class="event-params">${paramsHtml}</div>
        </div>
        <div class="event-response">
          <div class="response-status-row">
            ${httpStatusBadge(e.responseStatusCode)}
            <span class="muted small">Response</span>
          </div>
          ${responseContent}
        </div>
      </div>
    </div>
  `;
}

// ── Event handler wiring ──────────────────────────────────────────────────────

function attachHandlers(): void {
  // Label edit
  document.getElementById('label-display')?.addEventListener('click', () => {
    document.getElementById('label-display')!.style.display = 'none';
    document.getElementById('label-edit-form')!.style.display = 'flex';
    (document.getElementById('label-input') as HTMLInputElement).focus();
  });
  document.getElementById('label-cancel')?.addEventListener('click', () => {
    document.getElementById('label-display')!.style.display = '';
    document.getElementById('label-edit-form')!.style.display = 'none';
  });
  document.getElementById('label-save')?.addEventListener('click', () => {
    const val = (document.getElementById('label-input') as HTMLInputElement).value.trim();
    if (val && bookmark) {
      bookmark.label = val;
      post({ type: 'updateLabel', label: val, notes: bookmark.notes });
      document.getElementById('label-display')!.textContent = val;
      document.getElementById('label-display')!.style.display = '';
      document.getElementById('label-edit-form')!.style.display = 'none';
    }
  });

  // Tags
  document.getElementById('tag-input')?.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const input = e.target as HTMLInputElement;
      const tag = input.value.trim().toLowerCase();
      if (tag && bookmark && !bookmark.tags.includes(tag)) {
        bookmark.tags = [...bookmark.tags, tag];
        post({ type: 'updateTags', tags: bookmark.tags });
        tagInput = '';
        renderAll();
      }
    }
  });
  document.querySelectorAll<HTMLButtonElement>('.tag-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const tag = btn.dataset['tag'];
      if (tag && bookmark) {
        bookmark.tags = bookmark.tags.filter(t => t !== tag);
        post({ type: 'updateTags', tags: bookmark.tags });
        renderAll();
      }
    });
  });

  // Webhooks
  document.getElementById('webhook-edit-btn')?.addEventListener('click', () => {
    webhookEditing = true;
    renderAll();
  });
  document.getElementById('webhook-cancel-btn')?.addEventListener('click', () => {
    webhookEditing = false;
    webhookSaving = false;
    renderAll();
  });
  document.getElementById('webhook-form')?.addEventListener('submit', (e: Event) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const data = new FormData(form);
    const request: UpdateWebhooksRequest = {
      voiceUrl:               (data.get('voiceUrl')              as string) || undefined,
      voiceMethod:            (data.get('voiceMethod')           as 'GET' | 'POST') || 'POST',
      smsUrl:                 (data.get('smsUrl')                as string) || undefined,
      smsMethod:              (data.get('smsMethod')             as 'GET' | 'POST') || 'POST',
      statusCallback:         (data.get('statusCallback')        as string) || undefined,
      statusCallbackMethod:   (data.get('statusCallbackMethod')  as 'GET' | 'POST') || 'POST',
    };
    webhookSaving = true;
    renderAll();
    post({ type: 'saveWebhooks', request });
  });

  // Tabs
  document.querySelectorAll<HTMLButtonElement>('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset['tab'] as 'calls' | 'sms';
      activeTab = tab;
      renderAll();
      if (tab === 'calls' && !callLogsLoaded && !callLogsLoading) {
        startLoadCallLogs();
      }
      if (tab === 'sms' && !smsLogsLoaded && !smsLogsLoading) {
        startLoadSmsLogs();
      }
    });
  });

  // Load buttons
  document.getElementById('load-calls-btn')?.addEventListener('click', startLoadCallLogs);
  document.getElementById('load-sms-btn')?.addEventListener('click', startLoadSmsLogs);

  // Call log rows
  document.querySelectorAll<HTMLTableRowElement>('.log-row[data-sid]').forEach(row => {
    row.addEventListener('click', () => {
      const sid = row.dataset['sid'];
      if (sid) { openCallDetail(sid); }
    });
  });

  // Call detail panel close
  document.getElementById('detail-close')?.addEventListener('click', () => {
    callDetailPanelOpen = false;
    selectedCall = null;
    callRecordings = [];
    callEvents = [];
    callNotifications = [];
    renderAll();
  });

  // Recording play buttons
  document.querySelectorAll<HTMLButtonElement>('.btn-play').forEach(btn => {
    btn.addEventListener('click', () => {
      const sid = btn.dataset['sid'];
      if (sid && bookmark) {
        post({ type: 'playRecording', recordingSid: sid, accountSid: '' });
      }
    });
  });
}

function startLoadCallLogs(): void {
  callLogsLoading = true;
  renderAll();
  post({ type: 'loadCallLogs' });
}

function startLoadSmsLogs(): void {
  smsLogsLoading = true;
  renderAll();
  post({ type: 'loadSmsLogs' });
}

function openCallDetail(callSid: string): void {
  callDetailPanelOpen = true;
  callDetailLoading = true;
  selectedCall = null;
  callRecordings = [];
  callEvents = [];
  callNotifications = [];
  renderAll();
  post({ type: 'loadCallDetail', callSid });
}

// ── Message handler ───────────────────────────────────────────────────────────

window.addEventListener('message', (event: MessageEvent<ExtensionToWebviewMessage>) => {
  const msg = event.data;

  switch (msg.type) {
    case 'bookmarkLoaded':
      bookmark       = msg.bookmark;
      subaccountName = msg.subaccountName;
      renderAll();
      // Auto-load call logs on open
      if (!callLogsLoaded && !callLogsLoading) {
        startLoadCallLogs();
      }
      break;

    case 'phoneDetailLoaded':
      phoneDetail = msg.detail;
      renderAll();
      break;

    case 'callLogsLoaded':
      callLogs         = msg.entries;
      callLogsLoaded   = true;
      callLogsLoading  = false;
      renderAll();
      break;

    case 'smsLogsLoaded':
      smsLogs         = msg.entries;
      smsLogsLoaded   = true;
      smsLogsLoading  = false;
      renderAll();
      break;

    case 'callDetailLoaded':
      selectedCall        = msg.detail;
      callRecordings      = msg.recordings;
      callEvents          = msg.events;
      callNotifications   = msg.notifications;
      callDetailLoading   = false;
      callDetailPanelOpen = true;
      renderAll();
      break;

    case 'webhookSaved':
      webhookSaving  = false;
      webhookEditing = false;
      // Update local phoneDetail cache
      if (phoneDetail) {
        const form = document.getElementById('webhook-form') as HTMLFormElement | null;
        if (form) {
          const data = new FormData(form);
          phoneDetail = {
            ...phoneDetail,
            voiceUrl:              (data.get('voiceUrl') as string)            || undefined,
            voiceMethod:           (data.get('voiceMethod') as 'GET' | 'POST') || 'POST',
            smsUrl:                (data.get('smsUrl') as string)              || undefined,
            smsMethod:             (data.get('smsMethod') as 'GET' | 'POST')   || 'POST',
            statusCallback:        (data.get('statusCallback') as string)      || undefined,
            statusCallbackMethod:  (data.get('statusCallbackMethod') as 'GET' | 'POST') || 'POST',
          };
        }
      }
      renderAll();
      showToast('Webhooks saved.');
      break;

    case 'labelSaved':
    case 'tagsSaved':
      // No re-render needed; state already updated optimistically
      break;

    case 'error':
      showToast(msg.message, true);
      // Reset saving states
      webhookSaving    = false;
      callLogsLoading  = false;
      smsLogsLoading   = false;
      callDetailLoading = false;
      renderAll();
      break;

    case 'locked':
      showToast('Credentials locked. Unlock to refresh data.', true);
      break;
  }
});

// ── Toast ─────────────────────────────────────────────────────────────────────

function showToast(message: string, isError = false): void {
  const existing = document.getElementById('toast');
  if (existing) { existing.remove(); }
  const el = document.createElement('div');
  el.id = 'toast';
  el.className = `toast ${isError ? 'toast-error' : 'toast-success'}`;
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ── Styles ────────────────────────────────────────────────────────────────────

function injectStyles(): void {
  const style = document.createElement('style');
  style.textContent = `
    *, *::before, *::after { box-sizing: border-box; }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      margin: 0; padding: 0;
    }
    a { color: var(--vscode-textLink-foreground); }

    /* Layout */
    .layout { display: flex; height: 100vh; overflow: hidden; }
    .main-col { flex: 1; overflow-y: auto; min-width: 0; }
    .detail-col { width: 0; overflow: hidden; transition: width 0.2s ease; border-left: 1px solid transparent; }
    .detail-col.open { width: 420px; border-left-color: var(--vscode-panel-border); overflow-y: auto; }

    /* Sections */
    .section { padding: 16px 20px; border-bottom: 1px solid var(--vscode-panel-border); }
    .section-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
    .section-title { font-size: 0.85em; font-weight: 600; color: var(--vscode-descriptionForeground); text-transform: uppercase; letter-spacing: 0.05em; margin: 0; }

    /* Header */
    .header-section { padding-bottom: 12px; }
    .header-top { display: flex; align-items: flex-start; gap: 8px; }
    .page-title { font-size: 1.3em; font-weight: 600; margin: 0; line-height: 1.3; }
    .editable-label { cursor: pointer; border-bottom: 1px dashed transparent; }
    .editable-label:hover { border-bottom-color: var(--vscode-foreground); }
    .label-edit-form { display: flex; gap: 6px; align-items: center; flex: 1; }
    .label-input {
      flex: 1; background: var(--vscode-input-background); color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-focusBorder); padding: 4px 8px; font-size: 1.1em;
      font-family: inherit; border-radius: 2px; outline: none;
    }
    .header-meta { display: flex; gap: 6px; align-items: center; margin-top: 4px; font-size: 0.85em; color: var(--vscode-descriptionForeground); flex-wrap: wrap; }
    .meta-number { font-family: var(--vscode-editor-font-family); }
    .meta-sep { opacity: 0.5; }
    .meta-notes { font-style: italic; }

    /* Tags */
    .tags-section { padding-top: 10px; padding-bottom: 10px; }
    .tags-row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
    .tag-chip { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); border-radius: 10px; font-size: 0.8em; }
    .tag-chip.small { padding: 1px 6px; font-size: 0.75em; }
    .tag-remove { background: none; border: none; cursor: pointer; color: inherit; opacity: 0.7; padding: 0; font-size: 1em; line-height: 1; }
    .tag-remove:hover { opacity: 1; }
    .tag-input { background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, transparent); padding: 2px 8px; font-size: 0.8em; border-radius: 10px; outline: none; width: 120px; font-family: inherit; }
    .tag-input:focus { border-color: var(--vscode-focusBorder); }

    /* Webhooks */
    .webhooks-section {}
    .config-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 16px; }
    .config-row { display: contents; }
    .config-label { font-size: 0.8em; color: var(--vscode-descriptionForeground); padding: 3px 0; align-self: center; }
    .config-value { font-size: 0.85em; padding: 3px 0; word-break: break-all; }
    .webhook-form { display: flex; flex-direction: column; gap: 10px; }
    .form-field { display: flex; flex-direction: column; gap: 3px; }
    .form-field-narrow { max-width: 200px; }
    .form-field label { font-size: 0.8em; font-weight: 600; color: var(--vscode-descriptionForeground); }
    .form-field input, .form-field select {
      background: var(--vscode-input-background); color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, transparent); padding: 5px 8px;
      font-size: inherit; font-family: inherit; outline: none; border-radius: 2px;
    }
    .form-field input:focus, .form-field select:focus { border-color: var(--vscode-focusBorder); }
    .form-actions { margin-top: 4px; }
    .load-prompt { padding: 20px; text-align: center; }

    /* Tabs */
    .tabs { display: flex; border-bottom: 1px solid var(--vscode-panel-border); padding: 0 20px; }
    .tab { background: none; border: none; border-bottom: 2px solid transparent; padding: 8px 16px; font-size: 0.9em; font-family: inherit; cursor: pointer; color: var(--vscode-descriptionForeground); margin-bottom: -1px; }
    .tab.active { color: var(--vscode-foreground); border-bottom-color: var(--vscode-focusBorder); }
    .tab:hover:not(.active) { color: var(--vscode-foreground); }

    /* Tables */
    .table-wrap { overflow-x: auto; }
    .logs-table { width: 100%; border-collapse: collapse; font-size: 0.85em; }
    .logs-table th { text-align: left; padding: 8px 12px; font-size: 0.8em; font-weight: 600; color: var(--vscode-descriptionForeground); border-bottom: 1px solid var(--vscode-panel-border); white-space: nowrap; }
    .logs-table td { padding: 7px 12px; border-bottom: 1px solid var(--vscode-list-hoverBackground); white-space: nowrap; }
    .log-row { cursor: pointer; }
    .log-row:hover td { background: var(--vscode-list-hoverBackground); }
    .log-row.selected td { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
    .col-body { max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    /* Badges */
    .badge { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 0.8em; font-weight: 600; }
    .badge-green  { background: rgba(  0,180, 80,.18); color: #3fb950; }
    .badge-red    { background: rgba(240, 60, 60,.18); color: #f85149; }
    .badge-neutral{ background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
    .badge-blue   { background: rgba( 58,130,246,.18); color: #58a6ff; }
    .badge-purple { background: rgba(163, 94,245,.18); color: #bc8cff; }
    .count-badge { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); padding: 1px 6px; border-radius: 8px; font-size: 0.75em; font-weight: normal; margin-left: 6px; vertical-align: middle; }

    /* Buttons */
    .btn-small { padding: 3px 10px; font-size: 0.8em; font-family: inherit; cursor: pointer; border-radius: 2px; border: 1px solid var(--vscode-button-secondaryBackground); background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
    .btn-small:hover { background: var(--vscode-button-secondaryHoverBackground); }
    .btn-small.secondary { background: transparent; border-color: var(--vscode-panel-border); color: var(--vscode-foreground); }
    .btn-primary { padding: 5px 14px; font-size: inherit; font-family: inherit; cursor: pointer; border: none; border-radius: 2px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
    .btn-primary:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
    .btn-primary:disabled { opacity: 0.6; cursor: default; }
    .btn-icon-sm { background: none; border: none; cursor: pointer; font-size: 1.1em; padding: 4px 8px; color: var(--vscode-foreground); border-radius: 2px; }
    .btn-icon-sm:hover { background: var(--vscode-toolbar-hoverBackground); }
    .btn-play { padding: 2px 10px; font-size: 0.8em; font-family: inherit; cursor: pointer; border: 1px solid var(--vscode-button-background); background: transparent; color: var(--vscode-button-background); border-radius: 2px; white-space: nowrap; }
    .btn-play:hover { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }

    /* Call detail panel */
    .detail-panel { display: flex; flex-direction: column; height: 100%; }
    .detail-header { display: flex; align-items: center; gap: 8px; padding: 12px 16px; border-bottom: 1px solid var(--vscode-panel-border); position: sticky; top: 0; background: var(--vscode-editor-background); z-index: 5; }
    .detail-title { font-weight: 600; }
    .detail-body { padding: 16px; display: flex; flex-direction: column; gap: 16px; overflow-y: auto; flex: 1; }

    .detail-sid { display: flex; flex-direction: column; gap: 2px; }
    .detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 16px; }
    .detail-field { display: flex; flex-direction: column; gap: 2px; }
    .field-label { font-size: 0.75em; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--vscode-descriptionForeground); }
    .field-value { font-size: 0.9em; word-break: break-all; }

    .detail-section { border-top: 1px solid var(--vscode-panel-border); padding-top: 14px; }
    .detail-section-title { font-size: 0.8em; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--vscode-descriptionForeground); margin: 0 0 10px; }

    /* Recordings */
    .recording-card { background: var(--vscode-list-hoverBackground); border-radius: 4px; padding: 10px 12px; margin-bottom: 8px; }
    .recording-meta { display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; }
    .recording-info { display: flex; gap: 8px; align-items: center; font-size: 0.85em; flex-wrap: wrap; }
    .recording-sid { font-size: 0.75em; margin-top: 4px; }

    /* Events */
    .event-card { display: flex; gap: 10px; margin-bottom: 12px; }
    .event-number { width: 22px; height: 22px; border-radius: 50%; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); font-size: 0.75em; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-top: 2px; }
    .event-content { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
    .event-request, .event-response { background: var(--vscode-list-hoverBackground); border-radius: 4px; padding: 8px 10px; }
    .event-url-row { display: flex; align-items: baseline; gap: 6px; margin-bottom: 6px; flex-wrap: wrap; }
    .event-url { font-size: 0.8em; word-break: break-all; }
    .event-params { margin-top: 4px; }
    .params-table { border-collapse: collapse; width: 100%; font-size: 0.78em; }
    .params-table td { padding: 2px 8px 2px 0; vertical-align: top; }
    .param-name { color: var(--vscode-descriptionForeground); white-space: nowrap; padding-right: 12px !important; }
    .param-value { word-break: break-all; }
    .response-status-row { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
    .response-body { margin: 0; font-size: 0.78em; font-family: var(--vscode-editor-font-family); white-space: pre-wrap; word-break: break-all; max-height: 160px; overflow-y: auto; color: var(--vscode-foreground); }

    /* Issues */
    .issue-card { background: var(--vscode-list-hoverBackground); border-radius: 4px; padding: 10px 12px; margin-bottom: 8px; }
    .issue-header { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 6px; }
    .issue-message { font-size: 0.86em; }
    .issue-url { font-size: 0.75em; margin-top: 4px; word-break: break-all; }

    /* Misc */
    .mono { font-family: var(--vscode-editor-font-family); }
    .muted { color: var(--vscode-descriptionForeground); }
    .small { font-size: 0.85em; }
    .state-msg { padding: 24px; text-align: center; color: var(--vscode-descriptionForeground); }

    /* Toast */
    .toast { position: fixed; bottom: 20px; right: 20px; padding: 10px 16px; border-radius: 4px; font-size: 0.85em; z-index: 9999; box-shadow: 0 2px 8px rgba(0,0,0,.3); animation: fadeIn .15s ease; }
    .toast-success { background: var(--vscode-notificationToast-border, #3fb950); color: #fff; }
    .toast-error   { background: var(--vscode-inputValidation-errorBackground); border: 1px solid var(--vscode-inputValidation-errorBorder); color: var(--vscode-inputValidation-errorForeground); }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
  `;
  document.head.appendChild(style);
}

// ── Boot ──────────────────────────────────────────────────────────────────────

injectStyles();

document.getElementById('app')!.innerHTML =
  '<div class="state-msg muted">Loading bookmark…</div>';

post({ type: 'ready' });
