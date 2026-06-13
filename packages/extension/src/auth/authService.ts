import * as vscode from 'vscode';
import { DEFAULT_BACKEND_URL } from '../config';

export class AuthService implements vscode.UriHandler {
  private static instance: AuthService;
  private context: vscode.ExtensionContext;
  private token: string | null = null;
  private readonly TOKEN_SECRET_KEY = 'hitback_auth_token';
  
  // Event emitter for auth state changes
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

  /**
   * Initializes the auth service, loading the token from SecretStorage
   */
  public async initialize(): Promise<void> {
    try {
      const storedToken = await this.context.secrets.get(this.TOKEN_SECRET_KEY);
      if (storedToken) {
        this.token = storedToken;
        console.log('[Auth] Loaded token from SecretStorage.');
        this._onDidChangeAuth.fire(true);
      } else {
        console.log('[Auth] No token found in SecretStorage.');
        this._onDidChangeAuth.fire(false);
      }
    } catch (err) {
      console.log(`[Auth] Error reading from SecretStorage: ${err}`);
    }
  }

  /**
   * Initiates the login flow by opening the browser to the backend auth endpoint.
   */
  public async login(): Promise<void> {
    const backendUrl = vscode.workspace.getConfiguration('hitback').get<string>('backendUrl') || DEFAULT_BACKEND_URL;
    const appName = vscode.env.appName.toLowerCase();
    const editor = appName.includes('cursor') ? 'cursor' : 'vscode';

    // Pass editor so the callback tries the right deep link first, with fallback.
    const loginUrl = vscode.Uri.parse(`${backendUrl}/auth/google?context=${editor}`);
    
    console.log(`[Auth] Initiating login flow: ${loginUrl.toString()}`);
    
    const success = await vscode.env.openExternal(loginUrl);
    if (!success) {
      vscode.window.showErrorMessage('Failed to open browser for authentication.');
    } else {
      vscode.window.showInformationMessage('Opening browser to authenticate HitBack. Please switch back to your editor once you approve.');
    }
  }

  /**
   * Logs out the user by clearing the stored token.
   */
  public async logout(): Promise<void> {
    try {
      await this.context.secrets.delete(this.TOKEN_SECRET_KEY);
      this.token = null;
      console.log('[Auth] Token cleared.');
      this._onDidChangeAuth.fire(false);
      vscode.window.showInformationMessage('You have been logged out of HitBack.');
    } catch (err) {
      console.log(`[Auth] Error clearing SecretStorage: ${err}`);
      vscode.window.showErrorMessage('Failed to log out.');
    }
  }

  /**
   * Retrieves the active access token.
   */
  public getToken(): string | null {
    return this.token;
  }

  public isAuthenticated(): boolean {
    return this.token !== null;
  }

  /**
   * Handles deep links like: vscode://hitback.hitback-extension/auth-callback?token=xxx
   */
  public async handleUri(uri: vscode.Uri): Promise<void> {
    console.log(`[Auth] Received URI: ${uri.toString()}`);
    
    if (uri.path === '/auth-callback') {
      const query = new URLSearchParams(uri.query);
      const accessToken = query.get('token');
      
      if (accessToken) {
        console.log('[Auth] Extracted token from deep link.');
        try {
          await this.context.secrets.store(this.TOKEN_SECRET_KEY, accessToken);
          this.token = accessToken;
          this._onDidChangeAuth.fire(true);
          vscode.window.showInformationMessage('HitBack authentication successful!');
        } catch (err) {
          console.log(`[Auth] Failed to store token: ${err}`);
          vscode.window.showErrorMessage('Failed to securely store authentication token.');
        }
      } else {
        console.log('[Auth] Missing token in deep link.');
        vscode.window.showErrorMessage('Authentication failed: Missing token in callback.');
      }
    }
  }
}
