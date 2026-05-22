declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

interface AccountFormData {
  mode: 'add' | 'edit';
  id?: string;
  friendlyName?: string;
  accountSid?: string;
  error?: string;
}

type IncomingMessage =
  | { type: 'init'; data: AccountFormData }
  | { type: 'validationError'; field: string; message: string }
  | { type: 'saved' }
  | { type: 'error'; message: string };

const vscode = acquireVsCodeApi();

let mode: 'add' | 'edit' = 'add';
let accountId: string | undefined;

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function setFieldError(field: string, message: string): void {
  const el = document.getElementById(`${field}-error`);
  const input = document.getElementById(field) as HTMLInputElement | null;
  if (el) { el.textContent = message; el.style.display = 'block'; }
  if (input) { input.setAttribute('aria-invalid', 'true'); input.focus(); }
}

function clearErrors(): void {
  document.querySelectorAll<HTMLElement>('.field-error').forEach(el => {
    el.textContent = '';
    el.style.display = 'none';
  });
  document.querySelectorAll<HTMLInputElement>('[aria-invalid]').forEach(el => {
    el.removeAttribute('aria-invalid');
  });
}

function setGlobalError(message: string): void {
  const el = document.getElementById('global-error');
  if (el) { el.textContent = message; el.style.display = 'block'; }
}

function setSaving(saving: boolean): void {
  const btn = document.getElementById('save-btn') as HTMLButtonElement | null;
  if (btn) {
    btn.disabled = saving;
    btn.textContent = saving ? 'Saving…' : (mode === 'add' ? 'Add Account' : 'Save Changes');
  }
}

function validate(): boolean {
  clearErrors();
  let ok = true;
  const name = (document.getElementById('friendlyName') as HTMLInputElement).value.trim();
  const sid  = (document.getElementById('accountSid')   as HTMLInputElement).value.trim();
  const tok  = (document.getElementById('authToken')    as HTMLInputElement).value.trim();

  if (!name) { setFieldError('friendlyName', 'Friendly name is required.'); ok = false; }
  if (!sid)  { setFieldError('accountSid', 'Account SID is required.'); ok = false; }
  else if (!/^AC[a-fA-F0-9]{32}$/.test(sid)) {
    setFieldError('accountSid', 'Must be AC followed by 32 hex characters.');
    ok = false;
  }
  if (mode === 'add' && !tok) {
    setFieldError('authToken', 'Auth token is required.');
    ok = false;
  }
  return ok;
}

function onSubmit(e: Event): void {
  e.preventDefault();
  if (!validate()) { return; }
  setSaving(true);

  const name = (document.getElementById('friendlyName') as HTMLInputElement).value.trim();
  const sid  = (document.getElementById('accountSid')   as HTMLInputElement).value.trim();
  const tok  = (document.getElementById('authToken')    as HTMLInputElement).value.trim();

  vscode.postMessage({
    type: 'save',
    id: accountId,
    friendlyName: name,
    accountSid: sid,
    authToken: tok || undefined,
  });
}

function render(data: AccountFormData): void {
  mode      = data.mode;
  accountId = data.id;

  const title     = mode === 'add' ? 'Add Account' : 'Edit Account';
  const btnLabel  = mode === 'add' ? 'Add Account' : 'Save Changes';
  const sidNote   = mode === 'edit' ? '' : '<p class="hint">Starts with <code>AC</code> — found on your Twilio Console dashboard.</p>';
  const tokenNote = mode === 'edit'
    ? '<p class="hint">Leave blank to keep the existing auth token.</p>'
    : '<p class="hint">Found on your Twilio Console dashboard. Encrypted immediately — never stored in plaintext.</p>';

  document.body.innerHTML = `
    <div class="container">
      <h1>${esc(title)}</h1>
      <div id="global-error" class="global-error" style="display:none"></div>
      <form id="account-form" novalidate>
        <div class="field">
          <label for="friendlyName">Friendly name</label>
          <input id="friendlyName" type="text" autocomplete="off" spellcheck="false"
                 placeholder="e.g. Production" value="${esc(data.friendlyName ?? '')}">
          <span id="friendlyName-error" class="field-error" style="display:none"></span>
        </div>
        <div class="field">
          <label for="accountSid">Account SID</label>
          <input id="accountSid" type="text" autocomplete="off" spellcheck="false"
                 placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" value="${esc(data.accountSid ?? '')}">
          ${sidNote}
          <span id="accountSid-error" class="field-error" style="display:none"></span>
        </div>
        <div class="field">
          <label for="authToken">Auth token${mode === 'edit' ? ' <span class="optional">(optional)</span>' : ''}</label>
          <input id="authToken" type="password" autocomplete="new-password" placeholder="${mode === 'edit' ? '(unchanged)' : ''}">
          ${tokenNote}
          <span id="authToken-error" class="field-error" style="display:none"></span>
        </div>
        <div class="actions">
          <button id="save-btn" type="submit">${esc(btnLabel)}</button>
          <button id="cancel-btn" type="button" class="secondary">Cancel</button>
        </div>
      </form>
    </div>
  `;

  document.getElementById('account-form')!.addEventListener('submit', onSubmit);
  document.getElementById('cancel-btn')!.addEventListener('click', () => {
    vscode.postMessage({ type: 'cancel' });
  });

  // Focus first empty field
  const firstInput = document.querySelector<HTMLInputElement>('input:not([value]), input[value=""]');
  (firstInput ?? document.getElementById('friendlyName'))?.focus();
}

function injectStyles(): void {
  const style = document.createElement('style');
  style.textContent = `
    *, *::before, *::after { box-sizing: border-box; }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      margin: 0;
      padding: 0;
    }
    .container { max-width: 480px; margin: 32px auto; padding: 0 24px 48px; }
    h1 { font-size: 1.3em; font-weight: 600; margin-bottom: 24px; }
    .field { display: flex; flex-direction: column; margin-bottom: 16px; }
    label {
      font-size: 0.85em;
      font-weight: 600;
      margin-bottom: 4px;
      color: var(--vscode-foreground);
    }
    .optional { font-weight: 400; color: var(--vscode-descriptionForeground); }
    input {
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, transparent);
      padding: 6px 8px;
      font-size: inherit;
      font-family: inherit;
      outline: none;
      border-radius: 2px;
    }
    input:focus {
      border-color: var(--vscode-focusBorder);
      outline: 1px solid var(--vscode-focusBorder);
    }
    input[aria-invalid="true"] {
      border-color: var(--vscode-inputValidation-errorBorder);
    }
    .hint {
      font-size: 0.8em;
      color: var(--vscode-descriptionForeground);
      margin: 4px 0 0;
    }
    .hint code {
      font-family: var(--vscode-editor-font-family);
      background: var(--vscode-textCodeBlock-background);
      padding: 1px 4px;
      border-radius: 2px;
    }
    .field-error {
      font-size: 0.8em;
      color: var(--vscode-inputValidation-errorForeground, #f48771);
      margin-top: 4px;
    }
    .global-error {
      padding: 8px 12px;
      margin-bottom: 16px;
      background: var(--vscode-inputValidation-errorBackground);
      border: 1px solid var(--vscode-inputValidation-errorBorder);
      color: var(--vscode-inputValidation-errorForeground);
      font-size: 0.85em;
      border-radius: 2px;
    }
    .actions { display: flex; gap: 8px; margin-top: 24px; }
    button {
      padding: 6px 16px;
      font-size: inherit;
      font-family: inherit;
      cursor: pointer;
      border-radius: 2px;
      border: none;
    }
    button[type="submit"] {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    button[type="submit"]:hover:not(:disabled) {
      background: var(--vscode-button-hoverBackground);
    }
    button[type="submit"]:disabled {
      opacity: 0.6;
      cursor: default;
    }
    button.secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    button.secondary:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }
  `;
  document.head.appendChild(style);
}

// ── Boot ──────────────────────────────────────────────────────────────────────

injectStyles();
document.body.innerHTML = '<div class="container"><p>Loading…</p></div>';

window.addEventListener('message', (event: MessageEvent<IncomingMessage>) => {
  const msg = event.data;
  switch (msg.type) {
    case 'init':
      render(msg.data);
      break;
    case 'validationError':
      setSaving(false);
      setFieldError(msg.field, msg.message);
      break;
    case 'saved':
      // Panel will be closed by extension host
      break;
    case 'error':
      setSaving(false);
      setGlobalError(msg.message);
      break;
  }
});

vscode.postMessage({ type: 'ready' });
