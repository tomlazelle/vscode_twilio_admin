import * as vscode from 'vscode';
import { migrateFileStore } from './util/migration.js';
import { Logger } from './util/logger.js';
import { FileStore } from './store/fileStore.js';
import { SecretStore } from './store/secretStore.js';
import { SubaccountService } from './services/subaccountService.js';
import { BookmarkService } from './services/bookmarkService.js';
import { TwilioService } from './services/twilioService.js';
import { LogsService } from './services/logsService.js';
import { AccountsTreeProvider } from './views/accountsTreeProvider.js';
import { BookmarksTreeProvider } from './views/bookmarksTreeProvider.js';
import { TagsTreeProvider } from './views/tagsTreeProvider.js';
import { registerAccountCommands } from './commands/accountCommands.js';
import { registerBookmarkCommands } from './commands/bookmarkCommands.js';
import { registerCredentialCommands } from './commands/credentialCommands.js';
import type { ServiceContainer } from './types/models.js';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // 1. Run storage schema migrations (no-op for v1)
  await migrateFileStore(context.globalStorageUri);

  // 2. Instantiate stores
  const logger = new Logger(context);
  const fileStore = new FileStore(context.globalStorageUri);
  const secretStore = new SecretStore(context.secrets, context.globalStorageUri, logger);

  // 3. Instantiate services
  const subaccountService = new SubaccountService(fileStore, secretStore);
  const bookmarkService = new BookmarkService(fileStore);
  const twilioService = new TwilioService(subaccountService, logger);
  const logsService = new LogsService(twilioService, fileStore);

  const services: ServiceContainer = {
    subaccountService,
    bookmarkService,
    twilioService,
    logsService,
    secretStore,
    logger,
  };

  // 4. Register tree views
  const accountsTree = new AccountsTreeProvider(subaccountService, secretStore);
  const bookmarksTree = new BookmarksTreeProvider(bookmarkService);
  const tagsTree = new TagsTreeProvider(bookmarkService, bookmarksTree);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('twilioAdmin.accounts',  accountsTree),
    vscode.window.registerTreeDataProvider('twilioAdmin.bookmarks', bookmarksTree),
    vscode.window.registerTreeDataProvider('twilioAdmin.tags',      tagsTree)
  );

  // 5. Register commands
  registerAccountCommands(context, services, accountsTree, bookmarksTree, tagsTree);
  registerBookmarkCommands(context, services, bookmarksTree, tagsTree, context.extensionUri);
  registerCredentialCommands(context, services, accountsTree);

  // 6. Auto-unlock on startup
  const config = vscode.workspace.getConfiguration('twilioAdmin');
  if (config.get<boolean>('security.requireUnlockOnStartup')) {
    void secretStore.unlock().then(ok => {
      if (ok) {
        accountsTree.refresh();
        logger.info('Extension activated — credentials unlocked.');
      } else {
        logger.info('Extension activated — credentials locked (keychain unavailable).');
      }
    });
  } else {
    logger.info('Extension activated.');
  }
}

export function deactivate(): void {
  // masterKey is in-memory; it is zeroed when the process exits naturally.
}
