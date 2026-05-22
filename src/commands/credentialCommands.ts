import * as vscode from 'vscode';
import type { ServiceContainer } from '../types/models.js';
import type { AccountsTreeProvider } from '../views/accountsTreeProvider.js';

export function registerCredentialCommands(
  context: vscode.ExtensionContext,
  services: ServiceContainer,
  accountsTree: AccountsTreeProvider
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('twilioAdmin.lockCredentials', () =>
      lockCredentials(services, accountsTree)
    ),
    vscode.commands.registerCommand('twilioAdmin.unlockCredentials', () =>
      unlockCredentials(services, accountsTree)
    )
  );
}

async function lockCredentials(
  services: ServiceContainer,
  accountsTree: AccountsTreeProvider
): Promise<void> {
  services.secretStore.lock();
  accountsTree.refresh();
  vscode.window.showInformationMessage('Twilio Admin: credentials locked.');
}

async function unlockCredentials(
  services: ServiceContainer,
  accountsTree: AccountsTreeProvider
): Promise<void> {
  const config = vscode.workspace.getConfiguration('twilioAdmin');
  const passphraseEnabled = config.get<boolean>('security.passphraseFallbackEnabled') ?? true;

  // Try keychain first (no passphrase needed)
  const unlocked = await services.secretStore.unlock();
  if (unlocked) {
    accountsTree.refresh();
    return;
  }

  if (!passphraseEnabled) {
    vscode.window.showErrorMessage(
      'Could not unlock credentials. OS keychain unavailable and passphrase fallback is disabled.'
    );
    return;
  }

  // Prompt for passphrase
  const passphrase = await vscode.window.showInputBox({
    title: 'Unlock Twilio Admin',
    prompt: 'Enter your passphrase to unlock credentials',
    password: true,
    placeHolder: 'Passphrase',
    validateInput: v => (v.trim() ? null : 'Passphrase is required'),
  });
  if (!passphrase) { return; }

  const ok = await services.secretStore.unlock(passphrase);
  if (ok) {
    accountsTree.refresh();
    vscode.window.showInformationMessage('Twilio Admin: credentials unlocked.');
  } else {
    vscode.window.showErrorMessage('Failed to unlock credentials. Check your passphrase.');
  }
}
