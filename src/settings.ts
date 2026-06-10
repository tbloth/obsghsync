import { App, PluginSettingTab, Setting } from "obsidian";
import type GhSyncPlugin from "./main";

export class GhSyncSettingTab extends PluginSettingTab {
  plugin: GhSyncPlugin;

  constructor(app: App, plugin: GhSyncPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "GitHub Vault Sync" });

    new Setting(containerEl)
      .setName("Repository URL")
      .setDesc("HTTPS URL of your GitHub repository, e.g. https://github.com/you/vault.git")
      .addText((text) =>
        text
          .setPlaceholder("https://github.com/you/vault.git")
          .setValue(this.plugin.settings.repoUrl)
          .onChange(async (value) => {
            this.plugin.settings.repoUrl = value.trim();
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Authentication method")
      .setDesc(
        "PAT = paste a Personal Access Token. OAuth = sign in via browser (no PAT; needed for enterprise accounts that block PAT pushes).",
      )
      .addDropdown((dd) =>
        dd
          .addOption("pat", "Personal Access Token")
          .addOption("oauth", "OAuth (sign in with GitHub)")
          .setValue(this.plugin.settings.authMethod)
          .onChange(async (value) => {
            this.plugin.settings.authMethod = value as "pat" | "oauth";
            await this.plugin.saveSettings();
            this.display();
          }),
      );

    if (this.plugin.settings.authMethod === "pat") {
      new Setting(containerEl)
        .setName("Personal Access Token")
        .setDesc("GitHub PAT with 'repo' scope (fine-grained: Contents read/write). Stored locally in this vault.")
        .addText((text) => {
          text
            .setPlaceholder("github_pat_...")
            .setValue(this.plugin.settings.token)
            .onChange(async (value) => {
              this.plugin.settings.token = value.trim();
              await this.plugin.saveSettings();
            });
          text.inputEl.type = "password";
        });
    } else {
      new Setting(containerEl)
        .setName("OAuth Client ID")
        .setDesc(
          "Client ID of a GitHub OAuth App with Device Flow enabled. No client secret needed.",
        )
        .addText((text) =>
          text
            .setPlaceholder("Iv1.xxxxxxxxxxxxxxxx")
            .setValue(this.plugin.settings.oauthClientId)
            .onChange(async (value) => {
              this.plugin.settings.oauthClientId = value.trim();
              await this.plugin.saveSettings();
            }),
        );

      const signedIn = !!this.plugin.settings.oauthToken;
      new Setting(containerEl)
        .setName("GitHub sign-in")
        .setDesc(signedIn ? "Signed in. Token stored locally." : "Not signed in.")
        .addButton((btn) =>
          btn
            .setButtonText(signedIn ? "Re-authenticate" : "Sign in with GitHub")
            .setCta()
            .onClick(() => void this.plugin.signIn()),
        )
        .addButton((btn) => {
          btn.setButtonText("Sign out").onClick(async () => {
            this.plugin.settings.oauthToken = "";
            await this.plugin.saveSettings();
            this.display();
          });
          if (!signedIn) btn.setDisabled(true);
        });
    }

    new Setting(containerEl)
      .setName("Branch")
      .setDesc("Branch to sync with.")
      .addText((text) =>
        text
          .setPlaceholder("main")
          .setValue(this.plugin.settings.branch)
          .onChange(async (value) => {
            this.plugin.settings.branch = value.trim() || "main";
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Conflict strategy")
      .setDesc("How to resolve conflicting histories during a sync.")
      .addDropdown((dd) =>
        dd
          .addOption("localWins", "Local wins (force push)")
          .addOption("remoteWins", "Remote wins (discard local)")
          .setValue(this.plugin.settings.conflictStrategy)
          .onChange(async (value) => {
            this.plugin.settings.conflictStrategy =
              value as typeof this.plugin.settings.conflictStrategy;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Commit message")
      .setDesc("Template for commit messages. {{date}} is replaced with an ISO timestamp.")
      .addText((text) =>
        text
          .setPlaceholder("vault sync {{date}}")
          .setValue(this.plugin.settings.commitMessage)
          .onChange(async (value) => {
            this.plugin.settings.commitMessage = value || "vault sync {{date}}";
            await this.plugin.saveSettings();
          }),
      );

    containerEl.createEl("h3", { text: "Commit author" });

    new Setting(containerEl)
      .setName("Author name")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.authorName)
          .onChange(async (value) => {
            this.plugin.settings.authorName = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Author email")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.authorEmail)
          .onChange(async (value) => {
            this.plugin.settings.authorEmail = value;
            await this.plugin.saveSettings();
          }),
      );

    containerEl.createEl("h3", { text: "Automation" });

    new Setting(containerEl)
      .setName("Sync on startup")
      .setDesc("Automatically run a sync when Obsidian loads this vault.")
      .addToggle((tg) =>
        tg
          .setValue(this.plugin.settings.autoSyncOnStartup)
          .onChange(async (value) => {
            this.plugin.settings.autoSyncOnStartup = value;
            await this.plugin.saveSettings();
          }),
      );
  }
}
