import * as vscode from 'vscode';

const CURRENT_VERSION = 1;

export async function migrateFileStore(storageUri: vscode.Uri): Promise<void> {
  const versionUri = vscode.Uri.joinPath(storageUri, 'twilio-admin', 'version.json');
  let version = 0;

  try {
    const raw = await vscode.workspace.fs.readFile(versionUri);
    const parsed = JSON.parse(Buffer.from(raw).toString('utf-8')) as { version?: number };
    version = parsed.version ?? 0;
  } catch {
    // File doesn't exist yet — fresh install, start at 0
  }

  // Apply migrations in sequence
  // v0 → v1: initial version, no structural changes needed
  if (version < 1) {
    version = 1;
  }

  // Future migrations added here:
  // if (version < 2) { await migrateV1ToV2(storageUri); version = 2; }

  const dirUri = vscode.Uri.joinPath(storageUri, 'twilio-admin');
  await vscode.workspace.fs.createDirectory(dirUri);
  await vscode.workspace.fs.writeFile(
    versionUri,
    Buffer.from(JSON.stringify({ version: CURRENT_VERSION }), 'utf-8')
  );
}
