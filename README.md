# Twilio Admin

A VS Code extension for managing Twilio phone numbers across multiple subaccounts — without leaving your editor.

Twilio Admin is a local, single-user tool. It requires no backend service, no Docker, and no database. All data is stored on your local filesystem. Auth tokens are encrypted at rest using your OS keychain.

## Features

- **Accounts** — add, edit, and delete Twilio subaccounts; credentials are never stored in plaintext
- **Number browsing** — list all incoming phone numbers for any subaccount
- **Bookmarks** — pin important numbers with a label, notes, and tags for quick access
- **Webhook editor** — view and update voice, SMS, and status callback URLs and HTTP methods
- **Call & SMS logs** — review recent activity for any bookmarked number
- **Call detail** — inspect call metadata, recordings, and the full request/response event sequence
- **Tag filtering** — filter your bookmarks by tag from the Tags tree view

## Requirements

- VS Code 1.85 or later
- A Twilio account with one or more subaccountsp
- Node.js 20+ (development only — not required to run the installed extension)

## Installation

### From a `.vsix` file

1. Build the package (see [Development](#development) below), or obtain a pre-built `.vsix`.
2. In VS Code, open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and run **Extensions: Install from VSIX...**.
3. Select the `.vsix` file.
4. Reload VS Code when prompted.

### From source

```bash
git clone <repo-url>
cd vscode_twilio_admin
npm install
npm run compile:all
```

Then press `F5` in VS Code to launch an Extension Development Host with the extension loaded.

## Getting started

### 1. Add an account

Open the **Twilio Admin** panel in the Activity Bar (the icon in the left sidebar). In the **Accounts** view, click the **+** button or run **Twilio Admin: Add Account** from the Command Palette.

You will be prompted for:

| Field | Description |
|---|---|
| Friendly name | A display label — e.g. "Production" or "Staging" |
| Account SID | Your Twilio Account SID (starts with `AC`) |
| Auth Token | Your Twilio Auth Token — encrypted immediately, never logged |

### 2. Browse and bookmark numbers

Right-click an account in the **Accounts** tree and choose **Browse Numbers**. A webview panel opens listing all incoming phone numbers for that account. Click **Bookmark** on any number, give it a label, and it appears in the **Bookmarks** tree.

### 3. Edit webhooks

Click a bookmark in the **Bookmarks** tree to open the detail panel. The webhook form lets you update voice URL, voice method, SMS URL, SMS method, and status callback URL directly from VS Code.

### 4. View logs

In the bookmark detail panel, switch between the **Call Logs** and **SMS Logs** tabs. Click any call row to load its full detail, recordings, and event trace.

### 5. Lock and unlock credentials

Run **Twilio Admin: Lock Credentials** to clear auth tokens from memory. On next use, the extension re-reads them from the OS keychain (or prompts for your passphrase if the keychain is unavailable). Locking is automatic when VS Code closes.

## Credential security

Auth tokens are encrypted with **AES-256-GCM** before being written to disk. The key hierarchy works as follows:

- A random 256-bit **master key** is generated on first use and stored in VS Code's `SecretStorage`, which delegates to the OS keychain (Windows Credential Manager, macOS Keychain, or Linux libsecret).
- Each auth token is encrypted with its own random **data key**, which is itself encrypted with the master key. Only the ciphertext lands in the credentials file.
- If the OS keychain is unavailable, a passphrase-derived key is used instead (PBKDF2-HMAC-SHA256, 600,000 iterations). The passphrase is never persisted.

The file `secure/credentials.enc.json` in the extension's storage directory contains only ciphertext, IVs, and auth tags — never plaintext tokens.

## Data storage

All extension data is stored under VS Code's global storage path (typically `%APPDATA%\Code\User\globalStorage\twilio-admin\` on Windows):

```
twilio-admin/
├── subaccounts.json          # Account metadata (no auth tokens)
├── bookmarks.json            # Bookmarked numbers with labels and tags
├── preferences.json          # Active tag filter, last selected account
├── cache/
│   ├── call-logs/            # Cached call log responses
│   └── message-logs/         # Cached SMS log responses
└── secure/
    ├── credentials.enc.json  # Encrypted auth tokens
    └── metadata.json         # Encryption metadata (key reference, KDF params)
```

No data leaves your machine except for direct HTTPS calls to `api.twilio.com`.

## Settings

| Setting | Default | Description |
|---|---|---|
| `twilioAdmin.logs.pageSize` | `50` | Number of log entries fetched per request |
| `twilioAdmin.cache.enabled` | `true` | Cache API responses to disk |
| `twilioAdmin.cache.ttlSeconds` | `120` | Cache time-to-live in seconds |
| `twilioAdmin.security.requireUnlockOnStartup` | `true` | Unlock credentials automatically when VS Code starts |
| `twilioAdmin.security.passphraseFallbackEnabled` | `true` | Allow passphrase-based unlock when OS keychain is unavailable |

## Commands

All commands are available via the Command Palette (`Ctrl+Shift+P`) under the `Twilio Admin` category.

| Command | Description |
|---|---|
| `Twilio Admin: Add Account` | Add a new Twilio subaccount |
| `Twilio Admin: Edit Account` | Update a subaccount's name, SID, or auth token |
| `Twilio Admin: Delete Account` | Remove an account and all its bookmarks |
| `Twilio Admin: Browse Numbers` | Open the number browser for an account |
| `Twilio Admin: Open Bookmark` | Open the detail panel for a bookmarked number |
| `Twilio Admin: Edit Webhooks` | Jump directly to the webhook form in the detail panel |
| `Twilio Admin: Refresh Call Logs` | Force-refresh call logs for the open bookmark |
| `Twilio Admin: Refresh SMS Logs` | Force-refresh SMS logs for the open bookmark |
| `Twilio Admin: Lock Credentials` | Clear auth tokens from memory |
| `Twilio Admin: Unlock Credentials` | Reload auth tokens from the OS keychain or passphrase |

## Development

### Prerequisites

- Node.js 20+
- npm 9+

### Setup

```bash
npm install
```

> If you see an `UNABLE_TO_VERIFY_LEAF_SIGNATURE` error (common behind corporate proxies), use:
> ```bash
> npm install --strict-ssl=false
> ```

### Build

```bash
# Extension host only
npm run compile

# Webview UI only
npm run compile:webview

# Both
npm run compile:all

# Watch mode (rebuilds on save)
npm run watch
```

### Run in VS Code

Press `F5` to launch an Extension Development Host. The extension activates automatically on startup.

### Tests

```bash
# Unit tests (FileStore, SecretStore)
npm test

# Integration tests (requires VS Code)
npm run test:integration
```

### Package

```bash
npm run package
```

Produces `twilio-admin-0.1.0.vsix` in the project root.

### Project structure

```
src/
├── extension.ts              # Activation entry point
├── types/
│   ├── models.ts             # Domain interfaces and data shapes
│   └── messages.ts           # Webview ↔ extension message protocol
├── store/
│   ├── fileStore.ts          # JSON persistence via vscode.workspace.fs
│   └── secretStore.ts        # AES-256-GCM credential encryption
├── services/
│   ├── subaccountService.ts  # Account CRUD
│   ├── bookmarkService.ts    # Bookmark and tag CRUD
│   ├── twilioService.ts      # Twilio API client
│   └── logsService.ts        # Cached log retrieval
├── views/
│   ├── accountsTreeProvider.ts
│   ├── bookmarksTreeProvider.ts
│   └── tagsTreeProvider.ts
├── panels/
│   ├── bookmarkDetailPanel.ts
│   └── numberBrowserPanel.ts
├── commands/
│   ├── accountCommands.ts
│   ├── bookmarkCommands.ts
│   └── credentialCommands.ts
└── util/
    ├── logger.ts             # Output channel with secret redaction
    ├── nonce.ts              # CSP nonce generation
    └── migration.ts          # Storage schema migration runner
webview-ui/
└── src/
    ├── bookmarkDetail/       # Bookmark detail panel UI
    └── numberBrowser/        # Number browser panel UI
test/
├── __mocks__/vscode.ts       # VS Code API mock for unit tests
└── unit/
    ├── fileStore.test.ts
    └── secretStore.test.ts
```

## Migrating from the Twilio Admin web app

If you have data in the PostgreSQL-backed Twilio Admin web app, export your accounts, bookmarks, and tags as CSV and use the migration utility (available in a future release). You will be prompted to re-enter auth tokens — they cannot be migrated from the plaintext database export for security reasons.
