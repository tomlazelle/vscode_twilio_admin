import * as vscode from 'vscode';
import type { BookmarkRecord } from '../types/models.js';
import type { BookmarkService } from '../services/bookmarkService.js';

export class BookmarkTreeItem extends vscode.TreeItem {
  constructor(public readonly record: BookmarkRecord) {
    super(record.label, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'bookmark';
    this.description = record.phoneNumber;
    this.iconPath = new vscode.ThemeIcon('bookmark');
    this.tooltip = new vscode.MarkdownString(
      `**${record.label}**\n\n` +
      `Number: \`${record.phoneNumber}\`\n\n` +
      (record.tags.length > 0 ? `Tags: ${record.tags.join(', ')}\n\n` : '') +
      (record.notes ? `Notes: ${record.notes}` : '')
    );
    this.command = {
      command: 'twilioAdmin.openBookmarkDetail',
      title: 'Open Bookmark',
      arguments: [this],
    };
  }
}

export class BookmarksTreeProvider implements vscode.TreeDataProvider<BookmarkTreeItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private activeTagFilter: string | null = null;

  constructor(private readonly bookmarkService: BookmarkService) {}

  setTagFilter(tag: string | null): void {
    this.activeTagFilter = tag;
    this.refresh();
  }

  getActiveTagFilter(): string | null {
    return this.activeTagFilter;
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: BookmarkTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(_element?: BookmarkTreeItem): Promise<BookmarkTreeItem[]> {
    const records = this.activeTagFilter
      ? await this.bookmarkService.getByTag(this.activeTagFilter)
      : await this.bookmarkService.getAll();

    return records
      .sort((a, b) => a.label.localeCompare(b.label))
      .map(r => new BookmarkTreeItem(r));
  }
}
