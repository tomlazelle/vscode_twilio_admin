import * as vscode from 'vscode';
import { generateNonce } from '../util/nonce.js';
import type { ServiceContainer } from '../types/models.js';

interface SaveMessage {
  type: 'save';
  id?: string;
  friendlyName: string;
  accountSid: string;
  authToken?: string;
}

type IncomingMessage =
  | { type: 'ready' }
  | SaveMessage
  | { type: 'cancel' };

export class AccountFormPanel {
  static currentPanel: AccountFormPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _disposables: vscode.Disposable[] = [];
  private _onSaved?: () => void;

  static createOrShow(
    extensionUri: vscode.Uri,
    services: ServiceContainer,
    opts: { mode: 'add' } | { mode: 'edit'; accountId: string },
    onSaved?: () => void
  ): void {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

    if (AccountFormPanel.currentPanel) {
      AccountFormPanel.currentPanel._panel.reveal(column);
      return;
    }

    const title = opts.mode === 'add' ? 'Add Account' : 'Edit Account';
    const panel = vscode.window.createWebviewPanel(
      'twilioAdmin.accountForm',
      title,
      column,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist')],
        retainContextWhenHidden: false,
      }
    );

    AccountFormPanel.currentPanel = new AccountFormPanel(
      panel,
      extensionUri,
      services,
      opts,
      onSaved
    );
  }

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri,
    private readonly services: ServiceContainer,
    private readonly opts: { mode: 'add' } | { mode: 'edit'; accountId: string },
    onSaved?: () => void
  ) {
    this._panel = panel;
    this._onSaved = onSaved;
    this._panel.webview.html = this._getHtml(panel.webview);
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this._panel.webview.onDidReceiveMessage(
      (msg: IncomingMessage) => void this._handleMessage(msg),
      null,
      this._disposables
    );
  }

  private async _handleMessage(msg: IncomingMessage): Promise<void> {
    switch (msg.type) {
      case 'ready':
        await this._sendInit();
        break;

      case 'save':
        await this._handleSave(msg);
        break;

      case 'cancel':
        this.dispose();
        break;
    }
  }

  private async _sendInit(): Promise<void> {
    if (this.opts.mode === 'add') {
      void this._panel.webview.postMessage({
        type: 'init',
        data: { mode: 'add' },
      });
    } else {
      const account = await this.services.subaccountService.getById(this.opts.accountId);
      void this._panel.webview.postMessage({
        type: 'init',
        data: {
          mode: 'edit',
          id: this.opts.accountId,
          friendlyName: account?.friendlyName ?? '',
          accountSid: account?.accountSid ?? '',
        },
      });
    }
  }

  private async _handleSave(msg: SaveMessage): Promise<void> {
    // Re-validate on the extension side
    if (!msg.friendlyName?.trim()) {
      void this._panel.webview.postMessage({ type: 'validationError', field: 'friendlyName', message: 'Friendly name is required.' });
      return;
    }
    if (!/^AC[a-fA-F0-9]{32}$/.test(msg.accountSid?.trim() ?? '')) {
      void this._panel.webview.postMessage({ type: 'validationError', field: 'accountSid', message: 'Invalid Account SID format.' });
      return;
    }
    if (this.opts.mode === 'add' && !msg.authToken?.trim()) {
      void this._panel.webview.postMessage({ type: 'validationError', field: 'authToken', message: 'Auth token is required.' });
      return;
    }

    try {
      if (this.opts.mode === 'add') {
        await this.services.subaccountService.add({
          friendlyName: msg.friendlyName.trim(),
          accountSid: msg.accountSid.trim(),
          authToken: msg.authToken!.trim(),
        });
        this.services.logger.info(`Account "${msg.friendlyName}" added.`);
      } else {
        await this.services.subaccountService.update(this.opts.accountId, {
          friendlyName: msg.friendlyName.trim(),
          accountSid: msg.accountSid.trim(),
          authToken: msg.authToken?.trim() || undefined,
        });
        this.services.logger.info(`Account "${msg.friendlyName}" updated.`);
      }

      void this._panel.webview.postMessage({ type: 'saved' });
      this._onSaved?.();
      this.dispose();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      void this._panel.webview.postMessage({ type: 'error', message });
      this.services.logger.error('Failed to save account', err);
    }
  }

  private _getHtml(webview: vscode.Webview): string {
    const nonce = generateNonce();
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'accountForm.js')
    );

    return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'none';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Account</title>
</head>
<body>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  dispose(): void {
    AccountFormPanel.currentPanel = undefined;
    this._panel.dispose();
    for (const d of this._disposables) { d.dispose(); }
    this._disposables.length = 0;
  }
}
