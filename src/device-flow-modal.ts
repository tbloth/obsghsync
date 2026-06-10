import { App, Modal, Notice } from "obsidian";
import { DeviceCodeInfo } from "./oauth";

export class DeviceFlowModal extends Modal {
  cancelled = false;
  private codeEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;

  constructor(app: App) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Sign in with GitHub" });
    this.statusEl = contentEl.createEl("p", {
      text: "Requesting a device code from GitHub…",
    });
  }

  showCode(info: DeviceCodeInfo): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Sign in with GitHub" });

    contentEl.createEl("p", { text: "1. Copy this one-time code:" });

    const codeRow = contentEl.createDiv({ cls: "obsghsync-code-row" });
    this.codeEl = codeRow.createEl("code", { text: info.user_code });
    this.codeEl.style.fontSize = "1.6em";
    this.codeEl.style.letterSpacing = "0.15em";
    this.codeEl.style.userSelect = "all";

    const copyBtn = codeRow.createEl("button", { text: "Copy" });
    copyBtn.style.marginLeft = "1em";
    copyBtn.onclick = async () => {
      await navigator.clipboard.writeText(info.user_code);
      new Notice("Code copied.");
    };

    contentEl.createEl("p", { text: "2. Open GitHub and paste the code:" });
    const link = contentEl.createEl("a", {
      text: info.verification_uri,
      href: info.verification_uri_complete || info.verification_uri,
    });
    link.setAttr("target", "_blank");
    link.style.display = "block";
    link.style.marginBottom = "1em";

    this.statusEl = contentEl.createEl("p", {
      text: "3. Waiting for you to authorize…",
    });
    this.statusEl.style.opacity = "0.8";

    const cancelBtn = contentEl.createEl("button", { text: "Cancel" });
    cancelBtn.onclick = () => {
      this.cancelled = true;
      this.close();
    };
  }

  setStatus(text: string): void {
    if (this.statusEl) this.statusEl.setText(text);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
