import { DataAdapter, Notice } from "obsidian";
import git from "isomorphic-git";
import { Buffer } from "buffer";
import { createFs, ObsidianFs } from "./fs-adapter";
import { http } from "./http-client";
import { ChangedFile, GhSyncSettings, SyncResult } from "./types";

// isomorphic-git expects a global Buffer in some code paths.
if (typeof (window as unknown as { Buffer?: unknown }).Buffer === "undefined") {
  (window as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;
}

const DIR = "/";
const REMOTE = "origin";

export class GitEngine {
  private fs: ObsidianFs;

  constructor(
    private adapter: DataAdapter,
    private settings: GhSyncSettings,
  ) {
    this.fs = createFs(adapter);
  }

  private get common() {
    return { fs: this.fs, dir: DIR };
  }

  private onAuth = () => ({
    username: this.settings.token,
    password: "x-oauth-basic",
  });

  private get author() {
    return {
      name: this.settings.authorName || "obsghsync",
      email: this.settings.authorEmail || "obsghsync@users.noreply.github.com",
    };
  }

  async isRepo(): Promise<boolean> {
    return await this.adapter.exists(".git");
  }

  private async ensureRemote(): Promise<void> {
    const remotes = await git.listRemotes(this.common);
    const existing = remotes.find((r) => r.remote === REMOTE);
    if (existing && existing.url === this.settings.repoUrl) return;
    if (existing) await git.deleteRemote({ ...this.common, remote: REMOTE });
    await git.addRemote({
      ...this.common,
      remote: REMOTE,
      url: this.settings.repoUrl,
    });
  }

  private async hasCommits(): Promise<boolean> {
    try {
      await git.resolveRef({ ...this.common, ref: "HEAD" });
      return true;
    } catch {
      return false;
    }
  }

  /** Initialize the repo (if needed), wire up the remote, and merge remote state. */
  async setup(): Promise<string> {
    this.requireConfig();

    if (!(await this.isRepo())) {
      await git.init({
        ...this.common,
        defaultBranch: this.settings.branch,
      });
    }
    await this.ensureRemote();

    // Make sure local work is captured before we pull remote history in.
    const staged = await this.stageAll();
    if (staged > 0 || !(await this.hasCommits())) {
      await this.commit();
    }

    await git.fetch({
      ...this.common,
      http,
      remote: REMOTE,
      onAuth: this.onAuth,
      singleBranch: true,
      ref: this.settings.branch,
      tags: false,
    }).catch(() => {
      /* empty remote / branch not present yet — fine on first setup */
    });

    await this.mergeRemote();
    return "Setup complete. Repository is connected and ready to sync.";
  }

  /** Full sync: stage + commit local changes, pull remote, push. */
  async sync(): Promise<SyncResult> {
    this.requireConfig();
    if (!(await this.isRepo())) {
      throw new Error("Repository not initialized. Run 'Setup repository' first.");
    }
    await this.ensureRemote();

    const committed = await this.commitLocal();

    let pulled = false;
    try {
      await git.fetch({
        ...this.common,
        http,
        remote: REMOTE,
        onAuth: this.onAuth,
        singleBranch: true,
        ref: this.settings.branch,
        tags: false,
      });
      pulled = await this.mergeRemote();
    } catch (e) {
      throw new Error(`Pull failed: ${errMsg(e)}`);
    }

    let pushed = false;
    try {
      const res = await git.push({
        ...this.common,
        http,
        remote: REMOTE,
        ref: this.settings.branch,
        onAuth: this.onAuth,
        force: this.settings.conflictStrategy === "localWins",
      });
      pushed = !res.error;
      if (res.error) throw new Error(res.error);
    } catch (e) {
      throw new Error(`Push failed: ${errMsg(e)}`);
    }

    return {
      committed,
      pulled,
      pushed,
      message: `Synced. ${committed} file(s) committed${pulled ? ", pulled remote changes" : ""}${pushed ? ", pushed" : ""}.`,
    };
  }

  /** List changed (uncommitted) files in the working tree. */
  async status(): Promise<ChangedFile[]> {
    if (!(await this.isRepo())) return [];
    const matrix = await git.statusMatrix(this.common);
    const out: ChangedFile[] = [];
    for (const [path, head, workdir] of matrix) {
      if (head === 1 && workdir === 1) continue; // unchanged
      if (await git.isIgnored({ ...this.common, filepath: path })) continue;
      let state: ChangedFile["state"];
      if (workdir === 0) state = "deleted";
      else if (head === 0) state = "added";
      else state = "modified";
      out.push({ path, state });
    }
    return out;
  }

  private async stageAll(): Promise<number> {
    const matrix = await git.statusMatrix(this.common);
    let count = 0;
    for (const [path, head, workdir, stage] of matrix) {
      if (head === 1 && workdir === 1 && stage === 1) continue;
      if (await git.isIgnored({ ...this.common, filepath: path })) continue;
      if (workdir === 0) {
        await git.remove({ ...this.common, filepath: path });
      } else {
        await git.add({ ...this.common, filepath: path });
      }
      count++;
    }
    return count;
  }

  private async commit(): Promise<string> {
    const message = this.settings.commitMessage.replace(
      "{{date}}",
      new Date().toISOString(),
    );
    return await git.commit({
      ...this.common,
      message,
      author: this.author,
    });
  }

  private async commitLocal(): Promise<number> {
    const staged = await this.stageAll();
    if (staged === 0) return 0;
    await this.commit();
    return staged;
  }

  /** Merge fetched remote branch into local working tree. Returns true if anything changed. */
  private async mergeRemote(): Promise<boolean> {
    const remoteRef = `refs/remotes/${REMOTE}/${this.settings.branch}`;
    let remoteOid: string;
    try {
      remoteOid = await git.resolveRef({ ...this.common, ref: remoteRef });
    } catch {
      return false; // nothing fetched yet
    }

    // Unborn local branch: adopt remote wholesale.
    if (!(await this.hasCommits())) {
      await git.writeRef({
        ...this.common,
        ref: `refs/heads/${this.settings.branch}`,
        value: remoteOid,
        force: true,
      });
      await git.checkout({
        ...this.common,
        ref: this.settings.branch,
        force: true,
      });
      return true;
    }

    const localOid = await git.resolveRef({
      ...this.common,
      ref: this.settings.branch,
    });
    if (localOid === remoteOid) return false; // already up to date

    try {
      const result = await git.merge({
        ...this.common,
        ours: this.settings.branch,
        theirs: remoteOid,
        abortOnConflict: true,
        author: this.author,
        message: `merge ${REMOTE}/${this.settings.branch}`,
      });
      if (result.oid && result.oid !== localOid) {
        await git.checkout({
          ...this.common,
          ref: this.settings.branch,
          force: true,
        });
        return true;
      }
      return false;
    } catch (e) {
      // Conflicting histories — resolve by configured strategy.
      if (this.settings.conflictStrategy === "remoteWins") {
        await git.writeRef({
          ...this.common,
          ref: `refs/heads/${this.settings.branch}`,
          value: remoteOid,
          force: true,
        });
        await git.checkout({
          ...this.common,
          ref: this.settings.branch,
          force: true,
        });
        new Notice("obsghsync: conflict resolved — remote version kept.");
        return true;
      }
      // localWins: keep local history; push will be forced.
      new Notice("obsghsync: conflict resolved — local version kept (force push).");
      return false;
    }
  }

  private requireConfig(): void {
    if (!this.settings.repoUrl) throw new Error("Repository URL is not set.");
    if (!this.settings.token) throw new Error("Personal Access Token is not set.");
  }
}

function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
