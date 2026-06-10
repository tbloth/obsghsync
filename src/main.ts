import { Notice, Plugin } from "obsidian";
import { DEFAULT_SETTINGS, GhSyncSettings } from "./types";
import { GitEngine } from "./git-engine";
import { GhSyncSettingTab } from "./settings";
import { StatusModal } from "./sync-modal";
import { deviceFlowAuthenticate } from "./oauth";
import { DeviceFlowModal } from "./device-flow-modal";

export default class GhSyncPlugin extends Plugin {
  settings!: GhSyncSettings;
  private syncing = false;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.addSettingTab(new GhSyncSettingTab(this.app, this));

    this.addRibbonIcon("refresh-cw", "GitHub Vault Sync: Sync now", () => {
      void this.runSync();
    });

    this.addCommand({
      id: "sync-now",
      name: "Sync now",
      callback: () => void this.runSync(),
    });

    this.addCommand({
      id: "view-status",
      name: "View status",
      callback: () => void this.viewStatus(),
    });

    this.addCommand({
      id: "setup-repository",
      name: "Setup repository",
      callback: () => void this.runSetup(),
    });

    this.addCommand({
      id: "reset-local-repo",
      name: "Reset local git history (keep files)",
      callback: () => void this.resetLocalRepo(),
    });

    this.addCommand({
      id: "test-connection",
      name: "Test GitHub connection",
      callback: () => void this.testConnection(),
    });

    this.addCommand({
      id: "sign-in-github",
      name: "Sign in with GitHub (OAuth device flow)",
      callback: () => void this.signIn(),
    });

    if (this.settings.autoSyncOnStartup) {
      this.app.workspace.onLayoutReady(() => void this.runSync());
    }
  }

  private engine(): GitEngine {
    return new GitEngine(this.app.vault.adapter, this.settings);
  }

  private async runSetup(): Promise<void> {
    try {
      new Notice("obsghsync: setting up repository…");
      const msg = await this.engine().setup();
      new Notice(`obsghsync: ${msg}`);
    } catch (e) {
      this.fail("Setup", e);
    }
  }

  private async resetLocalRepo(): Promise<void> {
    try {
      await this.engine().resetLocalRepo();
      new Notice(
        "obsghsync: local git history purged. Run 'Setup repository' to start a clean history.",
        10000,
      );
    } catch (e) {
      this.fail("Reset", e);
    }
  }

  private async runSync(): Promise<void> {
    if (this.syncing) {
      new Notice("obsghsync: a sync is already running.");
      return;
    }
    this.syncing = true;
    try {
      new Notice("obsghsync: syncing…");
      const result = await this.engine().sync();
      new Notice(`obsghsync: ${result.message}`);
    } catch (e) {
      this.fail("Sync", e);
    } finally {
      this.syncing = false;
    }
  }

  private async viewStatus(): Promise<void> {
    try {
      const changes = await this.engine().status();
      new StatusModal(this.app, changes).open();
    } catch (e) {
      this.fail("Status", e);
    }
  }

  private async testConnection(): Promise<void> {
    try {
      new Notice("obsghsync: testing GitHub connection…");
      const summary = await this.engine().testConnection();
      new Notice(`obsghsync: ${summary}`, 12000);
    } catch (e) {
      this.fail("Test connection", e);
    }
  }

  async signIn(): Promise<void> {
    if (!this.settings.oauthClientId) {
      new Notice(
        "obsghsync: set an OAuth Client ID in settings first (Auth method: OAuth).",
        10000,
      );
      return;
    }
    const modal = new DeviceFlowModal(this.app);
    modal.open();
    try {
      const token = await deviceFlowAuthenticate(
        this.settings.oauthClientId,
        "repo",
        {
          onPrompt: (info) => modal.showCode(info),
          isCancelled: () => modal.cancelled,
        },
      );
      this.settings.oauthToken = token;
      this.settings.authMethod = "oauth";
      await this.saveSettings();
      modal.setStatus("✅ Signed in. You can close this and run Sync.");
      new Notice("obsghsync: signed in with GitHub.");
    } catch (e) {
      modal.setStatus("");
      this.fail("Sign-in", e);
    }
  }

  private fail(action: string, e: unknown): void {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`obsghsync ${action} failed:`, e);
    new Notice(`obsghsync ${action} failed: ${message}`, 8000);
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
