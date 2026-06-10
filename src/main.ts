import { Notice, Plugin } from "obsidian";
import { DEFAULT_SETTINGS, GhSyncSettings } from "./types";
import { GitEngine } from "./git-engine";
import { GhSyncSettingTab } from "./settings";
import { StatusModal } from "./sync-modal";

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
