import * as vscode from 'vscode';
import { AccountFormPanel } from '../panels/accountFormPanel.js';
import type { ServiceContainer } from '../types/models.js';
import type { AccountsTreeProvider, AccountTreeItem } from '../views/accountsTreeProvider.js';
import type { BookmarksTreeProvider } from '../views/bookmarksTreeProvider.js';
import type { TagsTreeProvider } from '../views/tagsTreeProvider.js';

export function registerAccountCommands(
  context: vscode.ExtensionContext,
  services: ServiceContainer,
  accountsTree: AccountsTreeProvider,
  bookmarksTree: BookmarksTreeProvider,
  tagsTree: TagsTreeProvider
): void {
  const refreshAll = () => {
    accountsTree.refresh();
    bookmarksTree.refresh();
    tagsTree.refresh();
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('twilioAdmin.addAccount', () =>
      addAccount(context.extensionUri, services, refreshAll)
    ),
    vscode.commands.registerCommand('twilioAdmin.editAccount', (item?: AccountTreeItem) =>
      editAccount(context.extensionUri, services, item, refreshAll)
    ),
    vscode.commands.registerCommand('twilioAdmin.deleteAccount', (item?: AccountTreeItem) =>
      deleteAccount(services, item, refreshAll)
    ),
    vscode.commands.registerCommand('twilioAdmin.refreshAccounts', () =>
      accountsTree.refresh()
    )
  );
}

async function addAccount(
  extensionUri: vscode.Uri,
  services: ServiceContainer,
  onSaved: () => void
): Promise<void> {
  if (services.secretStore.isLocked) {
    const unlock = await vscode.window.showWarningMessage(
      'Credentials are locked. Unlock to add an account.',
      'Unlock'
    );
    if (unlock) {
      await vscode.commands.executeCommand('twilioAdmin.unlockCredentials');
    }
    return;
  }

  AccountFormPanel.createOrShow(extensionUri, services, { mode: 'add' }, onSaved);
}

async function editAccount(
  extensionUri: vscode.Uri,
  services: ServiceContainer,
  item: AccountTreeItem | undefined,
  onSaved: () => void
): Promise<void> {
  if (services.secretStore.isLocked) {
    vscode.window.showWarningMessage('Credentials are locked. Unlock to edit an account.');
    return;
  }

  let accountId = item?.record?.id;
  if (!accountId) {
    const accounts = await services.subaccountService.getAll();
    if (accounts.length === 0) {
      vscode.window.showInformationMessage('No accounts to edit.');
      return;
    }
    const picked = await vscode.window.showQuickPick(
      accounts.map(a => ({ label: a.friendlyName, description: a.accountSid, id: a.id })),
      { title: 'Select account to edit' }
    );
    if (!picked) { return; }
    accountId = picked.id;
  }

  AccountFormPanel.createOrShow(
    extensionUri,
    services,
    { mode: 'edit', accountId },
    onSaved
  );
}

async function deleteAccount(
  services: ServiceContainer,
  item: AccountTreeItem | undefined,
  onDone: () => void
): Promise<void> {
  let record = item?.record;
  if (!record) {
    const accounts = await services.subaccountService.getAll();
    if (accounts.length === 0) {
      vscode.window.showInformationMessage('No accounts to delete.');
      return;
    }
    const picked = await vscode.window.showQuickPick(
      accounts.map(a => ({ label: a.friendlyName, description: a.accountSid, id: a.id })),
      { title: 'Select account to delete' }
    );
    if (!picked) { return; }
    record = accounts.find(a => a.id === picked.id);
    if (!record) { return; }
  }

  const confirm = await vscode.window.showWarningMessage(
    `Delete account "${record.friendlyName}"? This will also delete all its bookmarks.`,
    { modal: true },
    'Delete'
  );
  if (confirm !== 'Delete') { return; }

  try {
    await services.subaccountService.delete(record.id);
    onDone();
    services.logger.info(`Account "${record.friendlyName}" deleted.`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`Failed to delete account: ${msg}`);
    services.logger.error('Failed to delete account', err);
  }
}
