import * as vscode from 'vscode';
import { z } from 'zod';
import { generateNonce } from '../util/nonce.js';
import type { ServiceContainer } from '../types/models.js';
import type { ExtensionToWebviewMessage } from '../types/messages.js';
import { resolveUiTypographySettings } from '../util/uiTypographySettings.js';

const IncomingMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready') }),
  z.object({
    type: z.literal('save'),
    id: z.string().optional(),
    friendlyName: z.string(),
    accountSid: z.string(),
    authToken: z.string().optional(),
  }),
  z.object({ type: z.literal('cancel') }),
]);

type IncomingMessage = z.infer<typeof IncomingMessageSchema>;
type SaveMessage = Extract<IncomingMessage, { type: 'save' }>;

export class AccountFormPanel {
  static currentPanel: AccountFormPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _disposables: vscode.Disposable[] = [];
  private _onSaved?: () => void;

  static refreshCurrentTypography(): void {
    AccountFormPanel.currentPanel?._sendTypographySettings();
  }

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
      (raw: unknown) => void this._handleMessage(raw),
      null,
      this._disposables
    );
  }

  private async _handleMessage(raw: unknown): Promise<void> {
    const parsed = IncomingMessageSchema.safeParse(raw);
    if (!parsed.success) {
      this.services.logger.warn(`AccountForm received invalid message: ${JSON.stringify(raw)}`);
      return;
    }
    const msg = parsed.data;
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
    this._sendTypographySettings();

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

  private _sendTypographySettings(): void {
    this._postMessage({
      type: 'uiTypographySettings',
      settings: resolveUiTypographySettings(),
    });
  }

  private _postMessage(msg: ExtensionToWebviewMessage): void {
    void this._panel.webview.postMessage(msg);
  }

  dispose(): void {
    AccountFormPanel.currentPanel = undefined;
    this._panel.dispose();
    for (const d of this._disposables) { d.dispose(); }
    this._disposables.length = 0;
  }
}
