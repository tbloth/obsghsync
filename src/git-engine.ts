import { DataAdapter, Notice, requestUrl } from "obsidian";
import git from "isomorphic-git";
import { Buffer } from "buffer";
import { createFs, ObsidianFs } from "./fs-adapter";
import { createHttp } from "./http-client";
import { ChangedFile, GhSyncSettings, SyncResult } from "./types";

// isomorphic-git expects a global Buffer in some code paths.
if (typeof (window as unknown as { Buffer?: unknown }).Buffer === "undefined") {
  (window as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;
}

const DIR = "/";
const REMOTE = "origin";

export class GitEngine {
  private fs: ObsidianFs;
  private forcePushNeeded = false;

  constructor(
    private adapter: DataAdapter,
    private settings: GhSyncSettings,
  ) {
    this.fs = createFs(adapter);
  }

  private get common() {
    return { fs: this.fs, dir: DIR };
  }

  private get http() {
    return createHttp(this.settings.token);
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

  /** Query the remote (without fetching) for whether the configured branch exists. */
  private async remoteHasBranch(): Promise<boolean> {
    try {
      const refs = await git.listServerRefs({
        http: this.http,
        url: this.settings.repoUrl,
        onAuth: this.onAuth,
        prefix: `refs/heads/${this.settings.branch}`,
        protocolVersion: 1,
      });
      const target = `refs/heads/${this.settings.branch}`;
      return refs.some((r) => r.ref === target);
    } catch {
      return false;
    }
  }

  /**
   * Ensure the working tree is on the configured branch. Lets the user change
   * the Branch setting and re-run Setup without recreating the repo (e.g. to
   * sync to a non-default branch that side-steps default-branch rulesets).
   */
  private async ensureOnBranch(): Promise<void> {
    if (!(await this.hasCommits())) return;
    const current = await git.currentBranch({
      ...this.common,
      fullname: false,
    });
    if (current === this.settings.branch) return;

    const branches = await git.listBranches(this.common);
    if (branches.includes(this.settings.branch)) {
      await git.checkout({ ...this.common, ref: this.settings.branch });
    } else {
      // Create the branch at the current HEAD and switch to it.
      await git.branch({
        ...this.common,
        ref: this.settings.branch,
        checkout: true,
      });
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

    await this.ensureOnBranch();

    if (await this.remoteHasBranch()) {
      await git.fetch({
        ...this.common,
        http: this.http,
        remote: REMOTE,
        onAuth: this.onAuth,
        singleBranch: true,
        ref: this.settings.branch,
        tags: false,
      }).catch(() => {
        /* tolerate transient fetch issues during setup */
      });
      await this.mergeRemote();
    }

    return "Setup complete. Repository is connected and ready to sync.";
  }

  /** Full sync: stage + commit local changes, pull remote, push. */
  async sync(): Promise<SyncResult> {
    this.requireConfig();
    if (!(await this.isRepo())) {
      throw new Error("Repository not initialized. Run 'Setup repository' first.");
    }
    await this.ensureRemote();
    this.forcePushNeeded = false;

    const committed = await this.commitLocal();

    let pulled = false;
    try {
      if (await this.remoteHasBranch()) {
        await git.fetch({
          ...this.common,
          http: this.http,
          remote: REMOTE,
          onAuth: this.onAuth,
          singleBranch: true,
          ref: this.settings.branch,
          tags: false,
        });
        pulled = await this.mergeRemote();
      }
      // else: remote branch does not exist yet — the push below creates it.
    } catch (e) {
      throw new Error(`Pull failed: ${errMsg(e)}`);
    }

    let pushed = false;
    try {
      const res = await git.push({
        ...this.common,
        http: this.http,
        remote: REMOTE,
        ref: this.settings.branch,
        onAuth: this.onAuth,
        force: this.forcePushNeeded,
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
      this.forcePushNeeded = true;
      new Notice("obsghsync: conflict resolved — local version kept (force push).");
      return false;
    }
  }

  private requireConfig(): void {
    if (!this.settings.repoUrl) throw new Error("Repository URL is not set.");
    if (!this.settings.token) throw new Error("Personal Access Token is not set.");
  }

  /**
   * Diagnose auth/permissions against the GitHub REST API. Returns a
   * human-readable summary that pinpoints token, identity and access issues
   * (the usual cause of a 403 during sync).
   */
  async testConnection(): Promise<string> {
    this.requireConfig();
    const { owner, repo } = parseRepo(this.settings.repoUrl);
    const headers = {
      Authorization: `Bearer ${this.settings.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "obsghsync",
    };

    const who = await requestUrl({
      url: "https://api.github.com/user",
      headers,
      throw: false,
    });
    if (who.status === 401) {
      return "Token rejected (401). The Personal Access Token is invalid or expired.";
    }
    const login =
      who.status === 200 && who.json ? who.json.login : `(status ${who.status})`;

    const repoRes = await requestUrl({
      url: `https://api.github.com/repos/${owner}/${repo}`,
      headers,
      throw: false,
    });

    const sso =
      repoRes.headers?.["x-github-sso"] || repoRes.headers?.["X-GitHub-SSO"];

    if (repoRes.status === 200 && repoRes.json) {
      const perms = repoRes.json.permissions || {};
      return (
        `Authenticated as "${login}". Repo ${owner}/${repo}: ` +
        `pull=${!!perms.pull}, push=${!!perms.push}.` +
        (!perms.push
          ? " ⚠️ No push permission — token needs Contents: read & write."
          : " ✅ Ready to sync.")
      );
    }

    let message = "";
    try {
      message = repoRes.json?.message || "";
    } catch {
      /* ignore */
    }

    if (repoRes.status === 404) {
      return (
        `Authenticated as "${login}", but ${owner}/${repo} is not visible ` +
        `(404). Either the repo path is wrong, it is private and this token ` +
        `lacks access, or the token belongs to a different account.` +
        (sso ? ` SSO authorization required: ${sso}` : "")
      );
    }
    if (repoRes.status === 403) {
      return (
        `Authenticated as "${login}", but access to ${owner}/${repo} is ` +
        `forbidden (403).${message ? " " + message : ""}` +
        (sso
          ? ` This org enforces SSO — authorize the token: ${sso}`
          : " Likely the token lacks repo access, lacks Contents write, or the " +
            "org/EMU policy blocks it.")
      );
    }
    return `Repo check failed: HTTP ${repoRes.status}${message ? " — " + message : ""} (authenticated as "${login}").`;
  }
}

/** Parse owner/repo from an HTTPS GitHub URL. */
function parseRepo(url: string): { owner: string; repo: string } {
  const cleaned = url
    .trim()
    .replace(/^git\+/, "")
    .replace(/\.git$/, "")
    .replace(/\/$/, "");
  const m = cleaned.match(/github\.com[/:]([^/]+)\/(.+)$/i);
  if (!m) {
    throw new Error(
      `Could not parse owner/repo from "${url}". Use an HTTPS URL like https://github.com/owner/repo.git`,
    );
  }
  return { owner: m[1], repo: m[2] };
}

function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
