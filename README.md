# obsghsync — GitHub Vault Sync for Obsidian

Sync your Obsidian vault **to and from GitHub** on every platform — desktop,
iPadOS, and iOS. No native `git` binary required.

Built on [isomorphic-git](https://isomorphic-git.org/) (pure-JavaScript git) with
a filesystem adapter over Obsidian's vault API and an HTTP layer over Obsidian's
`requestUrl` (so it works on mobile without CORS problems).

> **Status:** v0.1 — early foundation. The full sync flow (init, commit, pull,
> push) is implemented; expect rough edges and please test against a throwaway
> vault first.

## Features

- **Cross-platform** — works where native git can't (iPadOS / iOS)
- **One-command sync** — stage → commit → pull → push
- **Status view** — see changed files before syncing
- **Simple conflict handling** — *local wins* (force push) or *remote wins*
- **Ribbon button** — quick-access sync from the sidebar
- Respects your vault's `.gitignore`

## Setup

1. Build (`npm install && npm run build`) or download a release.
2. Copy `main.js`, `manifest.json` into your vault's
   `.obsidian/plugins/obsghsync/` folder and enable the plugin.
3. Open **Settings → GitHub Vault Sync**:
   - **Repository URL** — HTTPS, e.g. `https://github.com/you/vault.git`
   - **Personal Access Token** — a [PAT](https://github.com/settings/tokens)
     with `repo` scope (or a fine-grained token with *Contents: read & write*)
   - **Branch** — defaults to `main`
4. Run the command **"GitHub Vault Sync: Setup repository"** once.
5. Run **"GitHub Vault Sync: Sync now"** whenever you want to sync.

## Commands

| Command | Description |
|---|---|
| `Sync now` | Commit local changes, pull remote, push |
| `View status` | List files with local changes |
| `Setup repository` | Initialize the repo and connect the remote |

## How it works

```
Sync now
  ├─ stage all changes (honoring .gitignore)
  ├─ commit (message template, {{date}} → ISO timestamp)
  ├─ fetch + merge remote branch
  │     └─ on conflict: apply your strategy (local wins / remote wins)
  └─ push (force when "local wins")
```

The git repository lives at `.git` inside your vault.

## Building from source

```bash
npm install
npm run build      # typecheck + production bundle -> main.js
npm run dev        # watch mode
```

## Requirements

- Obsidian 1.4.0+
- A GitHub repository (public or private)
- A GitHub Personal Access Token

## License

MIT — see [LICENSE](LICENSE).
