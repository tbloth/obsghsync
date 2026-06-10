export type ConflictStrategy = "localWins" | "remoteWins";

export interface GhSyncSettings {
  repoUrl: string;
  token: string;
  branch: string;
  authorName: string;
  authorEmail: string;
  commitMessage: string;
  conflictStrategy: ConflictStrategy;
  autoSyncOnStartup: boolean;
}

export const DEFAULT_SETTINGS: GhSyncSettings = {
  repoUrl: "",
  token: "",
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
