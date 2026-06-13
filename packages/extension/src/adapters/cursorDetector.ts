import * as path from "path";
import * as vscode from "vscode";

/**
 * Detects agent activity using EVERY available signal.
 * Single event from ANY source = show the ad.
 * 15 seconds of silence = hide the ad.
 *
 * IMPORTANT: Never reads file content — only reacts to events.
 */
export class CursorAgentDetector implements vscode.Disposable {
  private readonly _onAgentStart = new vscode.EventEmitter<void>();
  private readonly _onAgentStop = new vscode.EventEmitter<void>();

  public readonly onAgentStart = this._onAgentStart.event;
  public readonly onAgentStop = this._onAgentStop.event;

  private agentActive = false;
  private stopTimer: ReturnType<typeof setTimeout> | undefined;
  private disposables: vscode.Disposable[] = [];
  private fileWatchers: vscode.FileSystemWatcher[] = [];
  private watchedRoots = new Set<string>();
  private eventCount = 0;

  private static readonly KEEP_ALIVE_MS = 15000;

  constructor(
    private readonly initialWatchRoots: string[] = [],
    private readonly ignoredDocSchemes: Set<string> = new Set()
  ) {
    console.log("[HitBack:Detector] Initialized — ALL signals active");

    // ── Signal 1: Text document changes (typing & agent edits) ──
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        const { scheme, fsPath } = e.document.uri;
        if (!this.ignoredDocSchemes.has(scheme)) {
          this.handleEvent(`doc-edit: ${this.label(e.document.uri)}`);
        }
        if (scheme === "file") {
          this.addWatchRoot(path.dirname(fsPath));
        }
      })
    );

    this.disposables.push(
      vscode.workspace.onDidOpenTextDocument((doc) => {
        if (doc.uri.scheme === "file") {
          this.addWatchRoot(path.dirname(doc.uri.fsPath));
        }
      })
    );

    // ── Signal 2: File system watcher (disk writes) ──
    for (const root of this.initialWatchRoots) {
      this.addWatchRoot(root);
    }
    this.disposables.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        for (const folder of vscode.workspace.workspaceFolders ?? []) {
          this.addWatchRoot(folder.uri.fsPath);
        }
      })
    );

    // ── Signal 3: Files created/saved/deleted via VS Code API ──
    this.disposables.push(
      vscode.workspace.onDidCreateFiles((e) => {
        for (const f of e.files) {
          this.handleEvent(`api-create: ${this.label(f)}`);
          if (f.scheme === "file") {
            this.addWatchRoot(path.dirname(f.fsPath));
          }
        }
      })
    );
    this.disposables.push(
      vscode.workspace.onDidSaveTextDocument((doc) => {
        if (doc.uri.scheme === "file") {
          this.handleEvent(`save: ${this.label(doc.uri)}`);
        }
      })
    );
    this.disposables.push(
      vscode.workspace.onDidDeleteFiles((e) => {
        for (const f of e.files) {
          this.handleEvent(`api-delete: ${this.label(f)}`);
        }
      })
    );

    // ── Signal 4: Editor / terminal activity ──
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => {
        if (this.agentActive) {
          this.handleEvent("editor-switch");
        }
      })
    );
    this.disposables.push(
      vscode.window.onDidOpenTerminal(() => {
        this.handleEvent("terminal-open");
      })
    );
  }

  /** Watch a directory using RelativePattern — works without an open workspace folder. */
  private addWatchRoot(rootPath: string): void {
    const resolved = path.resolve(rootPath);
    if (this.watchedRoots.has(resolved)) {
      return;
    }
    this.watchedRoots.add(resolved);

    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(vscode.Uri.file(resolved), "**/*")
    );

    watcher.onDidChange((uri) => {
      this.handleEvent(`fs-change: ${this.label(uri)}`);
    });
    watcher.onDidCreate((uri) =>
      this.handleEvent(`fs-create: ${this.label(uri)}`)
    );
    watcher.onDidDelete((uri) =>
      this.handleEvent(`fs-delete: ${this.label(uri)}`)
    );

    this.fileWatchers.push(watcher);
  }

  private handleEvent(label: string): void {
    const filtered =
      label.includes("node_modules") ||
      label.includes(".git") ||
      label.includes("debug-2150e3.log") ||
      label.includes("\\out\\") ||
      label.includes("/out/") ||
      label.includes("\\dist\\") ||
      label.includes("/dist/");
    if (filtered) {
      return;
    }

    this.eventCount++;

    if (!this.agentActive) {
      this.agentActive = true;
      this.eventCount = 1;
      console.log(`[HitBack] 🚀 ${label} — SHOWING AD`);
      this._onAgentStart.fire();
    } else if (this.eventCount % 10 === 0) {
      console.log(`[HitBack] ...${this.eventCount} events (ad still showing)`);
    }

    if (this.stopTimer) {
      clearTimeout(this.stopTimer);
    }
    this.stopTimer = setTimeout(() => {
      if (this.agentActive) {
        this.agentActive = false;
        console.log(
          `[HitBack] ⏹️  15s silence — HIDING AD (${this.eventCount} total events)`
        );
        this._onAgentStop.fire();
      }
    }, CursorAgentDetector.KEEP_ALIVE_MS);
  }

  public get isActive(): boolean {
    return this.agentActive;
  }

  private label(uri: vscode.Uri): string {
    return uri.fsPath.split(/[\\/]/).pop() || uri.scheme;
  }

  dispose(): void {
    for (const w of this.fileWatchers) {
      w.dispose();
    }
    this.fileWatchers = [];
    this.watchedRoots.clear();
    for (const d of this.disposables) {
      d.dispose();
    }
    if (this.stopTimer) {
      clearTimeout(this.stopTimer);
    }
    this._onAgentStart.dispose();
    this._onAgentStop.dispose();
  }
}
