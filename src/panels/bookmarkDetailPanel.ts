import * as vscode from 'vscode';
import { generateNonce } from '../util/nonce.js';
import type { ServiceContainer } from '../types/models.js';
import type { ExtensionToWebviewMessage, WebviewToExtensionMessage } from '../types/messages.js';
import { z } from 'zod';
import { resolveUiTypographySettings } from '../util/uiTypographySettings.js';

// Zod schema for validating incoming webview messages
const UpdateWebhooksSchema = z.object({
  voiceUrl: z.string().optional(),
  voiceMethod: z.enum(['GET', 'POST']),
  smsUrl: z.string().optional(),
  smsMethod: z.enum(['GET', 'POST']),
  statusCallback: z.string().optional(),
  statusCallbackMethod: z.enum(['GET', 'POST']),
});

const IncomingMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready') }),
  z.object({ type: z.literal('updateLabel'), label: z.string().min(1), notes: z.string().optional() }),
  z.object({ type: z.literal('updateTags'),  tags: z.array(z.string()) }),
  z.object({ type: z.literal('saveWebhooks'), request: UpdateWebhooksSchema }),
  z.object({ type: z.literal('loadCallLogs'), loadMore: z.boolean().optional() }),
  z.object({ type: z.literal('refreshCallLogs') }),
  z.object({ type: z.literal('loadSmsLogs'), loadMore: z.boolean().optional() }),
  z.object({ type: z.literal('refreshSmsLogs') }),
  z.object({ type: z.literal('loadCallDetail'), callSid: z.string() }),
  z.object({ type: z.literal('playRecording'), recordingSid: z.string(), accountSid: z.string().optional() }),
]);

export class BookmarkDetailPanel {
  static currentPanel: BookmarkDetailPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _disposables: vscode.Disposable[] = [];

  static refreshCurrentTypography(): void {
    BookmarkDetailPanel.currentPanel?._sendTypographySettings();
  }

  static createOrShow(
    extensionUri: vscode.Uri,
    bookmarkId: string,
    services: ServiceContainer
  ): void {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (BookmarkDetailPanel.currentPanel) {
      BookmarkDetailPanel.currentPanel._panel.reveal(column);
      void BookmarkDetailPanel.currentPanel._loadBookmark(bookmarkId);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'twilioAdmin.bookmarkDetail',
      'Bookmark Detail',
      column ?? vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist')],
        retainContextWhenHidden: true,
      }
    );

    BookmarkDetailPanel.currentPanel = new BookmarkDetailPanel(
      panel,
      extensionUri,
      bookmarkId,
      services
    );
  }

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri,
    private bookmarkId: string,
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

  private async _loadBookmark(bookmarkId: string): Promise<void> {
    this.bookmarkId = bookmarkId;
    this._panel.webview.html = this._getHtml(this._panel.webview);
  }

  private async _loadInitialData(services: ServiceContainer): Promise<void> {
    this._sendTypographySettings();

    const bookmark = await services.bookmarkService.getById(this.bookmarkId);
    if (!bookmark) {
      this._postMessage({ type: 'error', message: 'Bookmark not found.' });
      return;
    }

    const account = await services.subaccountService.getById(bookmark.subaccountId);
    this._postMessage({
      type: 'bookmarkLoaded',
      bookmark,
      subaccountName: account?.friendlyName ?? 'Unknown',
    });

    // Load phone detail in background
    if (!services.secretStore.isLocked) {
      services.twilioService
        .getNumber(bookmark.subaccountId, bookmark.phoneNumberSid)
        .then(detail => this._postMessage({ type: 'phoneDetailLoaded', detail }))
        .catch(err => {
          const msg = err instanceof Error ? err.message : String(err);
          this._postMessage({ type: 'error', message: msg, context: 'phoneDetail' });
        });
    }
  }

  private async _handleMessage(raw: unknown): Promise<void> {
    const parsed = IncomingMessageSchema.safeParse(raw);
    if (!parsed.success) {
      this.services.logger.warn(`Webview sent invalid message: ${JSON.stringify(raw)}`);
      return;
    }
    const msg = parsed.data as WebviewToExtensionMessage;
    const bookmark = await this.services.bookmarkService.getById(this.bookmarkId);
    if (!bookmark) { return; }

    switch (msg.type) {
      case 'ready':
        this._sendTypographySettings();
        await this._loadInitialData(this.services);
        break;

      case 'updateLabel':
        await this.services.bookmarkService.updateLabel(this.bookmarkId, msg.label, msg.notes);
        this._postMessage({ type: 'labelSaved' });
        break;

      case 'updateTags':
        await this.services.bookmarkService.updateTags(this.bookmarkId, msg.tags);
        this._postMessage({ type: 'tagsSaved' });
        break;

      case 'saveWebhooks': {
        try {
          await this.services.twilioService.updateWebhooks(
            bookmark.subaccountId,
            bookmark.phoneNumberSid,
            msg.request
          );
          this._postMessage({ type: 'webhookSaved' });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this._postMessage({ type: 'error', message, context: 'saveWebhooks' });
        }
        break;
      }

      case 'loadCallLogs': {
        try {
          const page = await this.services.logsService.getCallLogs(
            bookmark.subaccountId,
            bookmark.phoneNumber,
            { loadMore: msg.loadMore }
          );
          this._postMessage({
            type: 'callLogsLoaded',
            entries: page.entries,
            hasMore: page.hasMore,
            nextPageUrls: page.nextPageUrls,
            updatedAt: page.updatedAt,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this._postMessage({ type: 'error', message, context: 'callLogs' });
        }
        break;
      }

      case 'refreshCallLogs': {
        try {
          const page = await this.services.logsService.getCallLogs(
            bookmark.subaccountId,
            bookmark.phoneNumber,
            { forceRefresh: true }
          );
          this._postMessage({
            type: 'callLogsLoaded',
            entries: page.entries,
            hasMore: page.hasMore,
            nextPageUrls: page.nextPageUrls,
            updatedAt: page.updatedAt,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this._postMessage({ type: 'error', message, context: 'callLogs' });
        }
        break;
      }

      case 'loadSmsLogs': {
        try {
          const page = await this.services.logsService.getMessageLogs(
            bookmark.subaccountId,
            bookmark.phoneNumber,
            { loadMore: msg.loadMore }
          );
          this._postMessage({
            type: 'smsLogsLoaded',
            entries: page.entries,
            hasMore: page.hasMore,
            nextPageUrls: page.nextPageUrls,
            updatedAt: page.updatedAt,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this._postMessage({ type: 'error', message, context: 'smsLogs' });
        }
        break;
      }

      case 'refreshSmsLogs': {
        try {
          const page = await this.services.logsService.getMessageLogs(
            bookmark.subaccountId,
            bookmark.phoneNumber,
            { forceRefresh: true }
          );
          this._postMessage({
            type: 'smsLogsLoaded',
            entries: page.entries,
            hasMore: page.hasMore,
            nextPageUrls: page.nextPageUrls,
            updatedAt: page.updatedAt,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this._postMessage({ type: 'error', message, context: 'smsLogs' });
        }
        break;
      }

      case 'loadCallDetail': {
        try {
          const recordingsPromise = this.services.twilioService
            .getCallRecordings(bookmark.subaccountId, msg.callSid)
            .catch(err => {
              this.services.logger.warn(`Call recordings unavailable for ${msg.callSid}: ${err instanceof Error ? err.message : String(err)}`);
              return [];
            });

          const eventsPromise = this.services.twilioService
            .getCallEvents(bookmark.subaccountId, msg.callSid)
            .catch(err => {
              this.services.logger.warn(`Call events unavailable for ${msg.callSid}: ${err instanceof Error ? err.message : String(err)}`);
              return [];
            });

          const notificationsPromise = this.services.twilioService
            .getCallNotifications(bookmark.subaccountId, msg.callSid)
            .catch(err => {
              this.services.logger.warn(`Call notifications unavailable for ${msg.callSid}: ${err instanceof Error ? err.message : String(err)}`);
              return [];
            });

          const [detail, recordings, events, notifications] = await Promise.all([
            this.services.twilioService.getCallDetail(bookmark.subaccountId, msg.callSid),
            recordingsPromise,
            eventsPromise,
            notificationsPromise,
          ]);
          this._postMessage({ type: 'callDetailLoaded', detail, recordings, events, notifications });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this._postMessage({ type: 'error', message, context: 'callDetail' });
        }
        break;
      }

      case 'playRecording': {
        try {
          const account = await this.services.subaccountService.getById(bookmark.subaccountId);
          if (!account) { break; }
          const authToken = await this.services.secretStore.getCredential(bookmark.subaccountId);

          const { default: https } = await import('https');
          const { join } = await import('path');
          const { tmpdir } = await import('os');
          const { createWriteStream } = await import('fs');

          const recordingUrl = `https://api.twilio.com/2010-04-01/Accounts/${account.accountSid}/Recordings/${msg.recordingSid}.mp3`;
          const credentials = Buffer.from(`${account.accountSid}:${authToken}`).toString('base64');
          const tmpPath = join(tmpdir(), `twilio-rec-${msg.recordingSid}.mp3`);

          await new Promise<void>((resolve, reject) => {
            const file = createWriteStream(tmpPath);
            https.get(recordingUrl, { headers: { Authorization: `Basic ${credentials}` } }, res => {
              if (res.statusCode === 302 || res.statusCode === 301) {
                // Follow redirect (recordings are sometimes redirected)
                const location = res.headers['location'];
                if (!location) { reject(new Error('Redirect with no location')); return; }
                https.get(location, { headers: { Authorization: `Basic ${credentials}` } }, res2 => {
                  res2.pipe(file);
                  file.on('finish', () => { file.close(); resolve(); });
                  res2.on('error', reject);
                }).on('error', reject);
              } else {
                res.pipe(file);
                file.on('finish', () => { file.close(); resolve(); });
                res.on('error', reject);
              }
            }).on('error', reject);
          });

          await vscode.env.openExternal(vscode.Uri.file(tmpPath));
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this._postMessage({ type: 'error', message, context: 'playRecording' });
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
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'bookmarkDetail.js')
    );
    const cspSource = webview.cspSource;

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; script-src 'nonce-${nonce}'; style-src ${cspSource} 'unsafe-inline'; img-src ${cspSource} data:; media-src blob: data:; connect-src 'none';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bookmark Detail</title>
</head>
<body>
  <div id="app">Loading...</div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  dispose(): void {
    BookmarkDetailPanel.currentPanel = undefined;
    this._panel.dispose();
    for (const d of this._disposables) { d.dispose(); }
    this._disposables.length = 0;
  }
}
