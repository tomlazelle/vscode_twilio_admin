import * as vscode from 'vscode';
import type { ServiceContainer } from '../types/models.js';
import type { BookmarksTreeProvider, BookmarkTreeItem } from '../views/bookmarksTreeProvider.js';
import type { TagsTreeProvider } from '../views/tagsTreeProvider.js';

export function registerBookmarkCommands(
  context: vscode.ExtensionContext,
  services: ServiceContainer,
  bookmarksTree: BookmarksTreeProvider,
  tagsTree: TagsTreeProvider,
  extensionUri: vscode.Uri
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'twilioAdmin.openBookmarkDetail',
      (item?: BookmarkTreeItem) => openBookmarkDetail(services, item, extensionUri)
    ),
    vscode.commands.registerCommand(
      'twilioAdmin.editWebhooks',
      (item?: BookmarkTreeItem) => openBookmarkDetail(services, item, extensionUri)
    ),
    vscode.commands.registerCommand(
      'twilioAdmin.refreshBookmarks',
      () => { bookmarksTree.refresh(); tagsTree.refresh(); }
    ),
    vscode.commands.registerCommand(
      'twilioAdmin.filterByTag',
      (tag: string) => filterByTag(tag, bookmarksTree, tagsTree)
    ),
    vscode.commands.registerCommand(
      'twilioAdmin.browseNumbers',
      (item?: { record?: { id: string } }) =>
        browseNumbers(services, item?.record?.id, extensionUri)
    ),
    vscode.commands.registerCommand('twilioAdmin.refreshCallLogs',    () => {/* handled by panel */}),
    vscode.commands.registerCommand('twilioAdmin.refreshMessageLogs', () => {/* handled by panel */}),
    vscode.commands.registerCommand('twilioAdmin.playRecording',      () => {/* handled by panel */}),
    vscode.commands.registerCommand('twilioAdmin.addBookmark',        () => {/* triggered via number browser panel */})
  );
}

async function openBookmarkDetail(
  services: ServiceContainer,
  item: BookmarkTreeItem | undefined,
  extensionUri: vscode.Uri
): Promise<void> {
  let bookmarkId = item?.record?.id;
  if (!bookmarkId) {
    const bookmarks = await services.bookmarkService.getAll();
    if (bookmarks.length === 0) {
      vscode.window.showInformationMessage('No bookmarks yet. Browse numbers to add one.');
      return;
    }
    const picked = await vscode.window.showQuickPick(
      bookmarks.map(b => ({ label: b.label, description: b.phoneNumber, id: b.id })),
      { title: 'Open Bookmark' }
    );
    if (!picked) { return; }
    bookmarkId = picked.id;
  }

  // Dynamically import panel to keep startup fast
  const { BookmarkDetailPanel } = await import('../panels/bookmarkDetailPanel.js');
  BookmarkDetailPanel.createOrShow(extensionUri, bookmarkId, services);
}

async function browseNumbers(
  services: ServiceContainer,
  subaccountId: string | undefined,
  extensionUri: vscode.Uri
): Promise<void> {
  if (services.secretStore.isLocked) {
    vscode.window.showWarningMessage('Credentials are locked. Unlock to browse numbers.');
    return;
  }

  let accountId = subaccountId;
  if (!accountId) {
    const accounts = await services.subaccountService.getAll();
    if (accounts.length === 0) {
      vscode.window.showInformationMessage('Add an account first.');
      return;
    }
    const picked = await vscode.window.showQuickPick(
      accounts.map(a => ({ label: a.friendlyName, description: a.accountSid, id: a.id })),
      { title: 'Select account to browse' }
    );
    if (!picked) { return; }
    accountId = picked.id;
  }

  const { NumberBrowserPanel } = await import('../panels/numberBrowserPanel.js');
  NumberBrowserPanel.createOrShow(extensionUri, accountId, services);
}

function filterByTag(
  tag: string,
  bookmarksTree: BookmarksTreeProvider,
  tagsTree: TagsTreeProvider
): void {
  const current = bookmarksTree.getActiveTagFilter();
  // Toggle: clicking the active tag clears the filter
  bookmarksTree.setTagFilter(current === tag ? null : tag);
  tagsTree.refresh();
}
