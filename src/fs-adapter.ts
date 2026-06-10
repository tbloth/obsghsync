import { DataAdapter } from "obsidian";

/**
 * Adapts Obsidian's vault DataAdapter to the `fs.promises`-style interface that
 * isomorphic-git expects. Paths handed to us by isomorphic-git are absolute
 * (rooted at "/"), so we strip the leading slash to get a vault-relative path.
 *
 * Works on every platform Obsidian runs on (desktop, iPadOS, iOS) because it
 * never touches Node's `fs` directly — only the abstract vault adapter.
 */

class FsError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = code;
  }
}

function enoent(path: string): FsError {
  return new FsError("ENOENT", `ENOENT: no such file or directory, '${path}'`);
}

interface StatLike {
  type: "file" | "directory";
  size: number;
  mtimeMs: number;
  ctimeMs: number;
}

function makeStat(s: StatLike) {
  const isFile = s.type === "file";
  return {
    type: s.type,
    mode: isFile ? 0o100644 : 0o040000,
    size: s.size,
    ino: 0,
    mtimeMs: s.mtimeMs,
    ctimeMs: s.ctimeMs,
    uid: 1,
    gid: 1,
    dev: 1,
    mtimeSeconds: Math.floor(s.mtimeMs / 1000),
    ctimeSeconds: Math.floor(s.ctimeMs / 1000),
    isFile: () => isFile,
    isDirectory: () => !isFile,
    isSymbolicLink: () => false,
  };
}

/** Normalize an isomorphic-git path into a vault-relative path. */
function vaultPath(p: string): string {
  let s = p.replace(/\\/g, "/");
  const segments: string[] = [];
  for (const part of s.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      segments.pop();
      continue;
    }
    segments.push(part);
  }
  return segments.join("/");
}

function basename(p: string): string {
  const parts = p.split("/");
  return parts[parts.length - 1];
}

export function createFs(adapter: DataAdapter) {
  const promises = {
    async readFile(
      path: string,
      options?: { encoding?: string } | string,
    ): Promise<string | Uint8Array> {
      const rel = vaultPath(path);
      const encoding =
        typeof options === "string" ? options : options?.encoding;
      if (!(await adapter.exists(rel))) throw enoent(path);
      if (encoding === "utf8" || encoding === "utf-8") {
        return await adapter.read(rel);
      }
      const buf = await adapter.readBinary(rel);
      return new Uint8Array(buf);
    },

    async writeFile(
      path: string,
      data: string | Uint8Array,
      options?: { encoding?: string } | string,
    ): Promise<void> {
      const rel = vaultPath(path);
      const encoding =
        typeof options === "string" ? options : options?.encoding;
      if (typeof data === "string" && encoding !== "hex" && encoding !== "base64") {
        await adapter.write(rel, data);
        return;
      }
      let bytes: Uint8Array;
      if (typeof data === "string") {
        // hex/base64 encoded string -> bytes
        bytes =
          encoding === "base64"
            ? Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
            : new Uint8Array(
                (data.match(/.{1,2}/g) || []).map((b) => parseInt(b, 16)),
              );
      } else {
        bytes = data;
      }
      const ab = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer;
      await adapter.writeBinary(rel, ab);
    },

    async unlink(path: string): Promise<void> {
      const rel = vaultPath(path);
      if (!(await adapter.exists(rel))) throw enoent(path);
      await adapter.remove(rel);
    },

    async readdir(path: string): Promise<string[]> {
      const rel = vaultPath(path);
      if (rel !== "" && !(await adapter.exists(rel))) throw enoent(path);
      const listing = await adapter.list(rel);
      const names = [
        ...listing.files.map(basename),
        ...listing.folders.map(basename),
      ];
      return names;
    },

    async mkdir(path: string): Promise<void> {
      const rel = vaultPath(path);
      if (rel === "") return;
      if (await adapter.exists(rel)) return;
      await adapter.mkdir(rel);
    },

    async rmdir(path: string): Promise<void> {
      const rel = vaultPath(path);
      if (!(await adapter.exists(rel))) throw enoent(path);
      await adapter.rmdir(rel, true);
    },

    async stat(path: string) {
      const rel = vaultPath(path);
      const s = await adapter.stat(rel);
      if (!s) throw enoent(path);
      return makeStat({
        type: s.type === "folder" ? "directory" : "file",
        size: s.size,
        mtimeMs: s.mtime,
        ctimeMs: s.ctime,
      });
    },

    async lstat(path: string) {
      return promises.stat(path);
    },

    async readlink(path: string): Promise<string> {
      throw new FsError("EINVAL", `EINVAL: symlinks unsupported, '${path}'`);
    },

    async symlink(): Promise<void> {
      throw new FsError("EPERM", "EPERM: symlinks unsupported");
    },

    async chmod(): Promise<void> {
      // no-op: Obsidian's adapter has no concept of file modes
    },
  };

  return { promises };
}

export type ObsidianFs = ReturnType<typeof createFs>;
