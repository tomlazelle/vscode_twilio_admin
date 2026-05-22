import * as vscode from 'vscode';

const SECRET_PATTERNS = [
  /\bSK[A-Z0-9]{32}\b/gi,
  /\bAC[A-Z0-9]{32}:[^\s"']*/gi,
  /"authToken"\s*:\s*"[^"]*"/g,
  /Authorization:\s*Basic\s+[A-Za-z0-9+/=]+/g,
];

export class Logger {
  private readonly channel: vscode.OutputChannel;

  constructor(context: vscode.ExtensionContext) {
    this.channel = vscode.window.createOutputChannel('Twilio Admin');
    context.subscriptions.push(this.channel);
  }

  static redact(text: string): string {
    let result = text;
    for (const pattern of SECRET_PATTERNS) {
      result = result.replace(pattern, '[REDACTED]');
    }
    return result;
  }

  info(message: string): void {
    this.log('INFO', message);
  }

  warn(message: string): void {
    this.log('WARN', message);
  }

  error(message: string, err?: unknown): void {
    const errStr = err instanceof Error ? ` — ${err.message}` : err ? ` — ${String(err)}` : '';
    this.log('ERROR', `${message}${errStr}`);
  }

  debug(message: string): void {
    const config = vscode.workspace.getConfiguration('twilioAdmin');
    if (config.get<boolean>('debug.enabled')) {
      this.log('DEBUG', message);
    }
  }

  private log(level: string, message: string): void {
    const timestamp = new Date().toISOString();
    this.channel.appendLine(`[${timestamp}] [${level}] ${Logger.redact(message)}`);
  }
}
