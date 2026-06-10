import { App, Modal } from "obsidian";
import { ChangedFile } from "./types";

export class StatusModal extends Modal {
  constructor(
    app: App,
    private changes: ChangedFile[],
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "GitHub Vault Sync — Status" });

    if (this.changes.length === 0) {
      contentEl.createEl("p", { text: "No local changes. Vault is clean." });
      return;
    }

    contentEl.createEl("p", {
      text: `${this.changes.length} changed file(s):`,
    });

    const list = contentEl.createEl("ul");
    const label: Record<ChangedFile["state"], string> = {
      added: "A",
      modified: "M",
      deleted: "D",
    };
    for (const change of this.changes) {
      const li = list.createEl("li");
      li.createEl("strong", { text: `[${label[change.state]}] ` });
      li.appendText(change.path);
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
