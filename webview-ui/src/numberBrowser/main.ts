import type { ExtensionToWebviewMessage } from '../../../src/types/messages.js';
import type { PhoneNumberSummary } from '../../../src/types/models.js';

declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();

// ── State ─────────────────────────────────────────────────────────────────────

let allNumbers: PhoneNumberSummary[] = [];
let bookmarkedSids: Record<string, string> = {};
let filterText = '';
let isLoading = true;

// ── Utilities ─────────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function normalizeFilter(s: string): string {
  // Strip spaces and dashes so "+1 800-555-1234" matches "8005551234"
  return s.replace(/[\s\-().+]/g, '').toLowerCase();
}

function matchesFilter(number: PhoneNumberSummary, norm: string): boolean {
  if (!norm) { return true; }
  const normPhone = normalizeFilter(number.phoneNumber);
  const normName  = number.friendlyName.toLowerCase();
  return normPhone.includes(norm) || normName.includes(norm);
}

function highlight(text: string, norm: string): string {
  if (!norm) { return esc(text); }
  // Match against the raw text (not the stripped version) for display purposes
  const idx = text.toLowerCase().indexOf(norm);
  if (idx === -1) {
    // Try the stripped approach — if the raw text doesn't contain the term
    // just return escaped (number still shows because normalizeFilter matched)
    return esc(text);
  }
  return (
    esc(text.slice(0, idx)) +
    `<mark>${esc(text.slice(idx, idx + norm.length))}</mark>` +
    esc(text.slice(idx + norm.length))
  );
}

// ── Render ────────────────────────────────────────────────────────────────────

function renderRows(): void {
  const tbody = document.getElementById('numbers-tbody');
  const emptyState = document.getElementById('empty-state');
  const countEl = document.getElementById('result-count');
  if (!tbody || !emptyState || !countEl) { return; }

  const norm = normalizeFilter(filterText);
  const filtered = allNumbers.filter(n => matchesFilter(n, norm));

  countEl.textContent = filterText
    ? `${filtered.length} of ${allNumbers.length}`
    : `${allNumbers.length}`;

  if (filtered.length === 0) {
    tbody.innerHTML = '';
    emptyState.style.display = 'block';
    emptyState.textContent = filterText
      ? `No numbers match "${esc(filterText)}".`
      : 'No phone numbers found for this account.';
    return;
  }

  emptyState.style.display = 'none';

  tbody.innerHTML = filtered.map(n => {
    const isBookmarked = Boolean(bookmarkedSids[n.sid]);
    const caps = [
      n.capabilities.voice ? 'Voice' : '',
      n.capabilities.sms   ? 'SMS'   : '',
      n.capabilities.mms   ? 'MMS'   : '',
    ].filter(Boolean).join(', ');

    const phoneHtml = highlight(n.phoneNumber, norm.length <= 4 ? norm : '');
    const nameHtml  = highlight(n.friendlyName, filterText.toLowerCase());

    return `<tr>
      <td class="col-number"><span class="number-text">${phoneHtml}</span></td>
      <td class="col-name">${nameHtml}</td>
      <td class="col-caps">${esc(caps)}</td>
      <td class="col-action">
        ${isBookmarked
          ? '<span class="badge-bookmarked">Bookmarked</span>'
          : `<button class="btn-bookmark" data-sid="${esc(n.sid)}" data-number="${esc(n.phoneNumber)}">Bookmark</button>`
        }
      </td>
    </tr>`;
  }).join('');
}

function renderShell(): void {
  const app = document.getElementById('app')!;
  app.innerHTML = `
    <div class="toolbar">
      <div class="filter-wrap">
        <span class="filter-icon">$(search)</span>
        <input
          id="filter-input"
          type="text"
          placeholder="Filter by number or name…"
          autocomplete="off"
          spellcheck="false"
          aria-label="Filter numbers"
        >
        <button id="filter-clear" class="filter-clear" aria-label="Clear filter" style="display:none">✕</button>
      </div>
      <span id="result-count" class="result-count"></span>
      <button id="refresh-btn" class="btn-icon" title="Refresh" aria-label="Refresh numbers">↻</button>
    </div>
    <div id="empty-state" class="empty-state" style="display:none"></div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th class="col-number">Phone Number</th>
            <th class="col-name">Friendly Name</th>
            <th class="col-caps">Capabilities</th>
            <th class="col-action"></th>
          </tr>
        </thead>
        <tbody id="numbers-tbody"></tbody>
      </table>
    </div>
  `;

  const filterInput = document.getElementById('filter-input') as HTMLInputElement;
  const filterClear = document.getElementById('filter-clear') as HTMLButtonElement;

  filterInput.addEventListener('input', () => {
    filterText = filterInput.value;
    filterClear.style.display = filterText ? 'flex' : 'none';
    renderRows();
  });

  filterClear.addEventListener('click', () => {
    filterText = '';
    filterInput.value = '';
    filterClear.style.display = 'none';
    filterInput.focus();
    renderRows();
  });

  // Keyboard shortcut: / focuses the filter
  document.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === '/' && document.activeElement !== filterInput) {
      e.preventDefault();
      filterInput.focus();
      filterInput.select();
    }
    if (e.key === 'Escape' && document.activeElement === filterInput) {
      filterText = '';
      filterInput.value = '';
      filterClear.style.display = 'none';
      filterInput.blur();
      renderRows();
    }
  });

  document.getElementById('refresh-btn')!.addEventListener('click', () => {
    showLoading();
    vscode.postMessage({ type: 'refreshNumbers' });
  });

  // Delegate bookmark button clicks
  document.getElementById('numbers-tbody')!.addEventListener('click', (e: MouseEvent) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.btn-bookmark');
    if (!btn) { return; }
    btn.disabled = true;
    btn.textContent = 'Saving…';
    vscode.postMessage({
      type: 'addBookmark',
      phoneNumberSid: btn.dataset['sid']!,
      phoneNumber: btn.dataset['number']!,
      label: btn.dataset['number']!,
      tags: [],
    });
  });
}

function showLoading(): void {
  const tbody = document.getElementById('numbers-tbody');
  const emptyState = document.getElementById('empty-state');
  if (tbody) { tbody.innerHTML = ''; }
  if (emptyState) {
    emptyState.style.display = 'block';
    emptyState.textContent = 'Loading numbers…';
  }
}

function showError(message: string): void {
  const app = document.getElementById('app')!;
  app.innerHTML = `<div class="error-banner">${esc(message)}</div>`;
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
      margin: 0;
      padding: 0;
    }
    #app { display: flex; flex-direction: column; height: 100vh; }

    /* Toolbar */
    .toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      border-bottom: 1px solid var(--vscode-panel-border, var(--vscode-editorWidget-border));
      background: var(--vscode-editor-background);
      position: sticky;
      top: 0;
      z-index: 10;
    }
    .filter-wrap {
      display: flex;
      align-items: center;
      flex: 1;
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 2px;
      padding: 0 6px;
    }
    .filter-wrap:focus-within {
      border-color: var(--vscode-focusBorder);
      outline: 1px solid var(--vscode-focusBorder);
    }
    .filter-icon { color: var(--vscode-input-placeholderForeground); font-size: 0.85em; margin-right: 4px; }
    #filter-input {
      flex: 1;
      background: transparent;
      border: none;
      outline: none;
      color: var(--vscode-input-foreground);
      font-size: inherit;
      font-family: inherit;
      padding: 5px 0;
    }
    .filter-clear {
      display: flex;
      align-items: center;
      justify-content: center;
      background: transparent;
      border: none;
      color: var(--vscode-input-placeholderForeground);
      cursor: pointer;
      padding: 0 2px;
      font-size: 0.8em;
      line-height: 1;
    }
    .filter-clear:hover { color: var(--vscode-foreground); }
    .result-count {
      font-size: 0.8em;
      color: var(--vscode-descriptionForeground);
      white-space: nowrap;
    }
    .btn-icon {
      background: transparent;
      border: none;
      color: var(--vscode-foreground);
      cursor: pointer;
      font-size: 1.1em;
      padding: 2px 6px;
      border-radius: 2px;
      line-height: 1;
    }
    .btn-icon:hover { background: var(--vscode-toolbar-hoverBackground); }

    /* Table */
    .table-wrap { flex: 1; overflow-y: auto; }
    table { width: 100%; border-collapse: collapse; }
    thead th {
      position: sticky;
      top: 0;
      background: var(--vscode-editor-background);
      text-align: left;
      font-size: 0.8em;
      font-weight: 600;
      color: var(--vscode-descriptionForeground);
      padding: 6px 12px;
      border-bottom: 1px solid var(--vscode-panel-border, var(--vscode-editorWidget-border));
      white-space: nowrap;
    }
    tbody tr { border-bottom: 1px solid var(--vscode-list-hoverBackground); }
    tbody tr:hover { background: var(--vscode-list-hoverBackground); }
    td { padding: 7px 12px; vertical-align: middle; }
    .col-number { white-space: nowrap; }
    .col-caps { font-size: 0.8em; color: var(--vscode-descriptionForeground); }
    .col-action { text-align: right; white-space: nowrap; }
    .number-text { font-family: var(--vscode-editor-font-family); }
    mark {
      background: var(--vscode-editor-findMatchHighlightBackground, rgba(234,92,0,.3));
      color: inherit;
      border-radius: 2px;
      padding: 0 1px;
    }

    /* Buttons and badges */
    .btn-bookmark {
      padding: 3px 10px;
      font-size: 0.85em;
      font-family: inherit;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 2px;
      cursor: pointer;
    }
    .btn-bookmark:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
    .btn-bookmark:disabled { opacity: 0.6; cursor: default; }
    .badge-bookmarked {
      font-size: 0.8em;
      color: var(--vscode-descriptionForeground);
      font-style: italic;
    }

    /* States */
    .empty-state {
      padding: 32px;
      text-align: center;
      color: var(--vscode-descriptionForeground);
    }
    .error-banner {
      margin: 24px;
      padding: 12px 16px;
      background: var(--vscode-inputValidation-errorBackground);
      border: 1px solid var(--vscode-inputValidation-errorBorder);
      color: var(--vscode-inputValidation-errorForeground);
      border-radius: 2px;
    }
  `;
  document.head.appendChild(style);
}

// ── Message handling ──────────────────────────────────────────────────────────

window.addEventListener('message', (event: MessageEvent<ExtensionToWebviewMessage>) => {
  const msg = event.data;
  switch (msg.type) {
    case 'numbersLoaded':
      allNumbers     = msg.numbers;
      bookmarkedSids = msg.bookmarkedSids;
      isLoading      = false;
      if (!document.getElementById('filter-input')) {
        renderShell();
      }
      renderRows();
      // Focus the filter if there are enough numbers to warrant it
      if (allNumbers.length > 5) {
        (document.getElementById('filter-input') as HTMLInputElement | null)?.focus();
      }
      break;

    case 'bookmarkAdded':
      // Reload numbers so the bookmarked badge appears immediately
      vscode.postMessage({ type: 'refreshNumbers' });
      break;

    case 'error':
      if (isLoading) {
        showError(msg.message);
      } else {
        // Non-fatal error during bookmark — re-enable any disabled bookmark button
        document.querySelectorAll<HTMLButtonElement>('.btn-bookmark:disabled').forEach(btn => {
          btn.disabled = false;
          btn.textContent = 'Bookmark';
        });
        const banner = document.createElement('div');
        banner.className = 'error-banner';
        banner.style.cssText = 'position:fixed;bottom:16px;right:16px;max-width:320px;z-index:999';
        banner.textContent = msg.message;
        document.body.appendChild(banner);
        setTimeout(() => banner.remove(), 4000);
      }
      break;
  }
});

// ── Boot ──────────────────────────────────────────────────────────────────────

injectStyles();

// Render shell immediately so the filter is ready when data arrives
renderShell();
showLoading();

vscode.postMessage({ type: 'ready' });
