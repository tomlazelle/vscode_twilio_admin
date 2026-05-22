import * as vscode from 'vscode';
import type { BookmarkService } from '../services/bookmarkService.js';
import type { BookmarksTreeProvider } from './bookmarksTreeProvider.js';

export class TagTreeItem extends vscode.TreeItem {
  constructor(
    public readonly tag: string,
    count: number,
    isActive: boolean
  ) {
    super(tag, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'tag';
    this.description = `${count}`;
    this.iconPath = isActive
      ? new vscode.ThemeIcon('tag', new vscode.ThemeColor('charts.blue'))
      : new vscode.ThemeIcon('tag');
    this.command = {
      command: 'twilioAdmin.filterByTag',
      title: 'Filter by Tag',
      arguments: [tag],
    };
  }
}

export class TagsTreeProvider implements vscode.TreeDataProvider<TagTreeItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(
    private readonly bookmarkService: BookmarkService,
    private readonly bookmarksTree: BookmarksTreeProvider
  ) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: TagTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(_element?: TagTreeItem): Promise<TagTreeItem[]> {
    const tags = await this.bookmarkService.getAllTags();
    const activeFilter = this.bookmarksTree.getActiveTagFilter();

    if (tags.length === 0) {
      return [];
    }

    const allBookmarks = await this.bookmarkService.getAll();
    const countByTag = new Map<string, number>();
    for (const b of allBookmarks) {
      for (const t of b.tags) {
        countByTag.set(t, (countByTag.get(t) ?? 0) + 1);
      }
    }
    return tags.map(tag => new TagTreeItem(tag, countByTag.get(tag) ?? 0, tag === activeFilter));
  }
}
