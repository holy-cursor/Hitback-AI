import * as vscode from "vscode";
import { DEFAULT_BACKEND_URL } from "../config";

const REQUEST_TIMEOUT_MS = 10000;

export class AuthService implements vscode.UriHandler {
  private static instance: AuthService;
  private context: vscode.ExtensionContext;
  private token: string | null = null;
  private readonly TOKEN_SECRET_KEY = "hitback_auth_token";

  private _onDidChangeAuth = new vscode.EventEmitter<boolean>();
  public readonly onDidChangeAuth = this._onDidChangeAuth.event;

  private constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  public static getInstance(context: vscode.ExtensionContext): AuthService {
    if (!AuthService.instance) {
      AuthService.instance = new AuthService(context);
    }
    return AuthService.instance;
  }

  public async initialize(): Promise<void> {
    try {
      const storedToken = await this.context.secrets.get(this.TOKEN_SECRET_KEY);
      if (storedToken) {
        this.token = storedToken;
        console.log("[Auth] Loaded token from SecretStorage.");
        this._onDidChangeAuth.fire(true);
      } else {
        console.log("[Auth] No token found in SecretStorage.");
        this._onDidChangeAuth.fire(false);
      }
    } catch (err) {
      console.log(`[Auth] Error reading from SecretStorage: ${err}`);
    }
  }

  private getBackendUrl(): string {
    return DEFAULT_BACKEND_URL;
  }

  private async storeToken(accessToken: string): Promise<void> {
    await this.context.secrets.store(this.TOKEN_SECRET_KEY, accessToken);
    this.token = accessToken;
    this._onDidChangeAuth.fire(true);
    void vscode.window.showInformationMessage("HitBack sign-in successful!");
  }

  /**
   * Explain why sign-in is required, then prompt for email sign-in.
   */
  public async promptSignIn(): Promise<void> {
    const proceed = await vscode.window.showInformationMessage(
      "HitBack requires sign-in before sponsored ads can show. Sign in to earn from agent wait-states.",
      { modal: true },
      "Continue",
      "Not now"
    );

    if (proceed !== "Continue") {
      return;
    }

    await this.loginWithEmail();
  }

  /** Entry point for HitBack: Login command and post-prompt flow. */
  public async login(): Promise<void> {
    await this.loginWithEmail();
  }

  private async loginWithEmail(): Promise<void> {
    const email = await vscode.window.showInputBox({
      title: "HitBack sign in",
      prompt: "Email address",
      placeHolder: "you@example.com",
      ignoreFocusOut: true,
    });

    if (!email?.trim()) {
      return;
    }

    const password = await vscode.window.showInputBox({
      title: "HitBack sign in",
      prompt: "Password",
      password: true,
      ignoreFocusOut: true,
    });

    if (!password) {
      return;
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      const response = await fetch(`${this.getBackendUrl()}/auth/login`, {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });

      clearTimeout(timeout);

      const data = (await response.json()) as {
        accessToken?: string;
        error?: string;
        needsConfirmation?: boolean;
      };

      if (!response.ok || !data.accessToken) {
        void vscode.window.showErrorMessage(data.error || "Sign in failed.");
        return;
      }

      await this.storeToken(data.accessToken);
    } catch (err) {
      console.log(`[Auth] Email login error: ${err}`);
      void vscode.window.showErrorMessage("Could not reach HitBack to sign in.");
    }
  }

  public async logout(): Promise<void> {
    await this.clearSession();
    void vscode.window.showInformationMessage("You have been logged out of HitBack.");
  }

  /** Drop stored credentials without a logout toast (e.g. expired session). */
  public async clearSession(): Promise<void> {
    try {
      await this.context.secrets.delete(this.TOKEN_SECRET_KEY);
      this.token = null;
      console.log("[Auth] Session cleared.");
      this._onDidChangeAuth.fire(false);
    } catch (err) {
      console.log(`[Auth] Error clearing SecretStorage: ${err}`);
    }
  }

  /**
   * Server rejected our token — clear local session and prompt to sign in again.
   */
  public async handleSessionExpired(): Promise<void> {
    await this.clearSession();
    await this.promptSignIn();
  }

  public getToken(): string | null {
    return this.token;
  }

  public isAuthenticated(): boolean {
    return this.token !== null;
  }

  public async handleUri(uri: vscode.Uri): Promise<void> {
    console.log(`[Auth] Received URI: ${uri.toString()}`);

    if (uri.path === "/auth-callback") {
      const query = new URLSearchParams(uri.query);
      const accessToken = query.get("token");

      if (accessToken) {
        console.log("[Auth] Extracted token from deep link.");
        try {
          await this.storeToken(accessToken);
        } catch (err) {
          console.log(`[Auth] Failed to store token: ${err}`);
          void vscode.window.showErrorMessage("Failed to securely store authentication token.");
        }
      } else {
        console.log("[Auth] Missing token in deep link.");
        void vscode.window.showErrorMessage("Authentication failed: Missing token in callback.");
      }
    }
  }
}
