import * as vscode from 'vscode';
import type { SubaccountRecord } from '../types/models.js';
import type { SubaccountService } from '../services/subaccountService.js';
import type { SecretStore } from '../store/secretStore.js';

export class AccountTreeItem extends vscode.TreeItem {
  constructor(
    public readonly record: SubaccountRecord,
    isLocked: boolean
  ) {
    super(record.friendlyName, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'account';
    this.description = record.accountSid.slice(0, 14) + '…';
    this.iconPath = isLocked
      ? new vscode.ThemeIcon('lock', new vscode.ThemeColor('list.warningForeground'))
      : new vscode.ThemeIcon('cloud');
    this.tooltip = new vscode.MarkdownString(
      `**${record.friendlyName}**\n\n` +
      `Account SID: \`${record.accountSid}\`\n\n` +
      `Added: ${new Date(record.createdAt).toLocaleDateString()}`
    );
  }
}

export class AccountsTreeProvider implements vscode.TreeDataProvider<AccountTreeItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(
    private readonly subaccountService: SubaccountService,
    private readonly secretStore: SecretStore
  ) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: AccountTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(_element?: AccountTreeItem): Promise<AccountTreeItem[]> {
    const records = await this.subaccountService.getAll();
    return records.map(r => new AccountTreeItem(r, this.secretStore.isLocked));
  }
}
