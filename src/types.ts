export type ConflictStrategy = "localWins" | "remoteWins";

export type AuthMethod = "pat" | "oauth";

export interface GhSyncSettings {
  authMethod: AuthMethod;
  repoUrl: string;
  token: string;
  oauthClientId: string;
  oauthToken: string;
  branch: string;
  authorName: string;
  authorEmail: string;
  commitMessage: string;
  conflictStrategy: ConflictStrategy;
  autoSyncOnStartup: boolean;
}

export const DEFAULT_SETTINGS: GhSyncSettings = {
  authMethod: "pat",
  repoUrl: "",
  token: "",
  oauthClientId: "",
  oauthToken: "",
  branch: "main",
  authorName: "obsghsync",
  authorEmail: "obsghsync@users.noreply.github.com",
  commitMessage: "vault sync {{date}}",
  conflictStrategy: "localWins",
  autoSyncOnStartup: false,
};

export interface ChangedFile {
  path: string;
  /** 'modified' | 'added' | 'deleted' */
  state: "modified" | "added" | "deleted";
}

export interface SyncResult {
  committed: number;
  pulled: boolean;
  pushed: boolean;
  message: string;
}
