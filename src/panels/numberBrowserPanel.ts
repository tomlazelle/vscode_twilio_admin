import * as vscode from 'vscode';
import { generateNonce } from '../util/nonce.js';
import type { ServiceContainer } from '../types/models.js';
import type { ExtensionToWebviewMessage, WebviewToExtensionMessage } from '../types/messages.js';
import { z } from 'zod';
import { resolveUiTypographySettings } from '../util/uiTypographySettings.js';

const IncomingMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready') }),
  z.object({ type: z.literal('refreshNumbers') }),
  z.object({
    type: z.literal('addBookmark'),
    phoneNumberSid: z.string(),
    phoneNumber: z.string(),
    label: z.string().min(1),
    tags: z.array(z.string()),
  }),
]);

export class NumberBrowserPanel {
  static currentPanel: NumberBrowserPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _disposables: vscode.Disposable[] = [];

  static refreshCurrentTypography(): void {
    NumberBrowserPanel.currentPanel?._sendTypographySettings();
  }

  static createOrShow(
    extensionUri: vscode.Uri,
    subaccountId: string,
    services: ServiceContainer
  ): void {
    const column = vscode.window.activeTextEditor?.viewColumn;

    if (NumberBrowserPanel.currentPanel) {
      const existing = NumberBrowserPanel.currentPanel;
      existing._subaccountId = subaccountId;
      existing._panel.reveal(column);
      void existing._loadNumbers();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'twilioAdmin.numberBrowser',
      'Browse Numbers',
      column ?? vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist')],
        retainContextWhenHidden: true,
      }
    );

    NumberBrowserPanel.currentPanel = new NumberBrowserPanel(
      panel,
      extensionUri,
      subaccountId,
      services
    );
  }

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri,
    private _subaccountId: string,
    private readonly services: ServiceContainer
  ) {
    this._panel = panel;
    this._panel.webview.html = this._getHtml(panel.webview);

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this._panel.webview.onDidReceiveMessage(
      (raw: unknown) => void this._handleMessage(raw),
      null,
      this._disposables
    );
  }

  private async _loadNumbers(): Promise<void> {
    try {
      const [numbers, allBookmarks] = await Promise.all([
        this.services.twilioService.listNumbers(this._subaccountId),
        this.services.bookmarkService.getAll(),
      ]);
      const bookmarkedSids: Record<string, string> = {};
      for (const b of allBookmarks) {
        if (b.subaccountId === this._subaccountId) {
          bookmarkedSids[b.phoneNumberSid] = b.id;
        }
      }
      this._postMessage({ type: 'numbersLoaded', numbers, bookmarkedSids });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this._postMessage({ type: 'error', message });
    }
  }

  private async _handleMessage(raw: unknown): Promise<void> {
    const parsed = IncomingMessageSchema.safeParse(raw);
    if (!parsed.success) {
      this.services.logger.warn(`NumberBrowser received invalid message: ${JSON.stringify(raw)}`);
      return;
    }
    const msg = parsed.data as WebviewToExtensionMessage;

    switch (msg.type) {
      case 'ready':
        this._sendTypographySettings();
        await this._loadNumbers();
        break;

      case 'refreshNumbers':
        await this._loadNumbers();
        break;

      case 'addBookmark': {
        const label = await vscode.window.showInputBox({
          title: 'Add Bookmark',
          prompt: 'Label for this number',
          value: msg.label || msg.phoneNumber,
          validateInput: v => (v.trim() ? null : 'Label is required'),
        });
        if (!label) { return; }

        try {
          const bookmark = await this.services.bookmarkService.add({
            subaccountId: this._subaccountId,
            phoneNumberSid: msg.phoneNumberSid,
            phoneNumber: msg.phoneNumber,
            label: label.trim(),
            tags: msg.tags,
          });
          this._postMessage({ type: 'bookmarkAdded', bookmarkId: bookmark.id });
          // Refresh the numbers list to reflect the new bookmark
          await this._loadNumbers();
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this._postMessage({ type: 'error', message });
        }
        break;
      }
    }
  }

  private _postMessage(msg: ExtensionToWebviewMessage): void {
    void this._panel.webview.postMessage(msg);
  }

  private _sendTypographySettings(): void {
    this._postMessage({
      type: 'uiTypographySettings',
      settings: resolveUiTypographySettings(),
    });
  }

  private _getHtml(webview: vscode.Webview): string {
    const nonce = generateNonce();
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'numberBrowser.js')
    );
    const cspSource = webview.cspSource;

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; script-src 'nonce-${nonce}'; style-src ${cspSource} 'unsafe-inline'; img-src ${cspSource} data:; connect-src 'none';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Browse Numbers</title>
</head>
<body>
  <div id="app">Loading...</div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  dispose(): void {
    NumberBrowserPanel.currentPanel = undefined;
    this._panel.dispose();
    for (const d of this._disposables) { d.dispose(); }
    this._disposables.length = 0;
  }
}
