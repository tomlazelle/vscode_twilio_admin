/**
 * Minimal VS Code API mock for Vitest unit tests.
 * Only implements the subset used by FileStore, SecretStore, and Logger.
 */
import { vi } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

// ── Uri ───────────────────────────────────────────────────────────────────────

export class Uri {
  static file(fsPath: string): Uri {
    return new Uri(fsPath);
  }

  static joinPath(base: Uri, ...segments: string[]): Uri {
    return new Uri(path.join(base.fsPath, ...segments));
  }

  static parse(value: string): Uri {
    // Simple file:// stripping for tests
    return new Uri(value.replace(/^file:\/\//, ''));
  }

  constructor(public readonly fsPath: string) {}

  get path(): string { return this.fsPath; }
  toString(): string { return `file://${this.fsPath}`; }
}

// ── workspace.fs backed by real Node fs ─────────────────────────────────────

export const workspace = {
  fs: {
    async readFile(uri: Uri): Promise<Uint8Array> {
      return fs.readFileSync(uri.fsPath);
    },
    async writeFile(uri: Uri, content: Uint8Array): Promise<void> {
      fs.mkdirSync(path.dirname(uri.fsPath), { recursive: true });
      fs.writeFileSync(uri.fsPath, content);
    },
    async rename(from: Uri, to: Uri, _opts?: unknown): Promise<void> {
      fs.renameSync(from.fsPath, to.fsPath);
    },
    async copy(from: Uri, to: Uri, _opts?: unknown): Promise<void> {
      fs.copyFileSync(from.fsPath, to.fsPath);
    },
    async delete(uri: Uri, _opts?: unknown): Promise<void> {
      if (fs.existsSync(uri.fsPath)) {
        fs.unlinkSync(uri.fsPath);
      }
    },
    async createDirectory(uri: Uri): Promise<void> {
      fs.mkdirSync(uri.fsPath, { recursive: true });
    },
  },
  getConfiguration(_section?: string) {
    return {
      get<T>(key: string, defaultValue?: T): T | undefined {
        const defaults: Record<string, unknown> = {
          'cache.enabled': true,
          'cache.ttlSeconds': 120,
          'logs.pageSize': 50,
          'security.requireUnlockOnStartup': true,
          'security.passphraseFallbackEnabled': true,
        };
        return (defaults[key] ?? defaultValue) as T;
      },
    };
  },
};

// ── window ────────────────────────────────────────────────────────────────────

export const window = {
  createOutputChannel: vi.fn(() => ({
    appendLine: vi.fn(),
    show: vi.fn(),
    dispose: vi.fn(),
  })),
  showInformationMessage: vi.fn(),
  showWarningMessage: vi.fn(),
  showErrorMessage: vi.fn(),
  showInputBox: vi.fn(),
  showQuickPick: vi.fn(),
};

// ── SecretStorage ─────────────────────────────────────────────────────────────

export function createMockSecretStorage(): {
  get: (key: string) => Promise<string | undefined>;
  store: (key: string, value: string) => Promise<void>;
  delete: (key: string) => Promise<void>;
} {
  const store = new Map<string, string>();
  return {
    get: async (key: string) => store.get(key),
    store: async (key: string, value: string) => { store.set(key, value); },
    delete: async (key: string) => { store.delete(key); },
  };
}

// ── TreeItem, ThemeIcon, etc. ─────────────────────────────────────────────────

export class TreeItem {
  contextValue?: string;
  description?: string;
  tooltip?: unknown;
  iconPath?: unknown;
  command?: unknown;
  constructor(public label: string, public collapsibleState?: number) {}
}

export class ThemeIcon {
  constructor(public id: string, public color?: unknown) {}
}

export class ThemeColor {
  constructor(public id: string) {}
}

export class MarkdownString {
  constructor(public value: string) {}
}

export enum TreeItemCollapsibleState {
  None = 0,
  Collapsed = 1,
  Expanded = 2,
}

export class EventEmitter<T> {
  private listeners: Array<(e: T) => void> = [];
  event = (listener: (e: T) => void) => {
    this.listeners.push(listener);
    return { dispose: () => { this.listeners = this.listeners.filter(l => l !== listener); } };
  };
  fire(data: T): void { this.listeners.forEach(l => l(data)); }
  dispose(): void { this.listeners = []; }
}

export class CancellationError extends Error {
  constructor() { super('Cancelled'); this.name = 'CancellationError'; }
}

export enum ViewColumn { One = 1, Two = 2, Three = 3 }

export const commands = {
  registerCommand: vi.fn((_id: string, _cb: unknown) => ({ dispose: vi.fn() })),
  executeCommand: vi.fn(),
};

export const extensions = { getExtension: vi.fn() };

// ── Temp dir helper for tests ─────────────────────────────────────────────────

export function makeTempStorageUri(): Uri {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'twilio-admin-test-'));
  return new Uri(dir);
}
