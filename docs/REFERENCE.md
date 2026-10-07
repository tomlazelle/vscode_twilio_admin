# Twilio Admin — Developer & Reference Notes

Material moved out of the README. The README covers installing and using the extension; this file covers building, releasing, internals, and storage details.

## Requirements (development)

- Node.js 20+ (not required to run the installed extension)
- npm 9+

## Installing from source

```bash
git clone <repo-url>
cd vscode_twilio_admin
npm install
npm run compile:all
```

Then press `F5` in VS Code to launch an Extension Development Host with the extension loaded.

## Building a `.vsix`

Build the package (see [Package](#package)), then in VS Code run **Extensions: Install from VSIX...** from the Command Palette and select the file. Reload VS Code when prompted.

## Development

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

## CI and release

This repository uses two GitHub Actions workflows for releases:

- `.github/workflows/semantic-release.yml`
    - Trigger: push to `main`
    - Runs `semantic-release` to compute the next release, update changelog/version metadata, and publish a GitHub release.

- `.github/workflows/release-artifact.yml`
    - Trigger: published release (and manual `workflow_dispatch`)
    - Checks out the release tag, normalizes the package version from the tag, builds the extension, and uploads the `.vsix` artifact to that release.

### Tag format for release artifacts

The artifact workflow accepts these tag forms and converts them to a valid extension version before packaging:

- `v1` -> `1.0.0`
- `v1.2` -> `1.2.0`
- `v1.2.3` (or prerelease/build variants) -> unchanged semantic version

If a tag cannot be normalized to a semantic version, the workflow fails early with a clear error.

## Project structure

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

## Credential security (details)

Auth tokens are encrypted with **AES-256-GCM** before being written to disk. The key hierarchy works as follows:

- A random 256-bit **master key** is generated on first use and stored in VS Code's `SecretStorage`, which delegates to the OS keychain (Windows Credential Manager, macOS Keychain, or Linux libsecret).
- Each auth token is encrypted with its own random **data key**, which is itself encrypted with the master key. Only the ciphertext lands in the credentials file.
- If the OS keychain is unavailable, a passphrase-derived key is used instead (PBKDF2-HMAC-SHA256, 600,000 iterations). The passphrase is never persisted.

The file `secure/credentials.enc.json` in the extension's storage directory contains only ciphertext, IVs, and auth tags — never plaintext tokens.

## Data storage layout

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

## Migrating from the Twilio Admin web app

If you have data in the PostgreSQL-backed Twilio Admin web app, export your accounts, bookmarks, and tags as CSV and use the migration utility (available in a future release). You will be prompted to re-enter auth tokens — they cannot be migrated from the plaintext database export for security reasons.
