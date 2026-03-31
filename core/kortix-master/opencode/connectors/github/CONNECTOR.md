---
name: github
description: "GitHub repositories, PRs, issues, actions, and API via the gh CLI"
type: cli
status: disconnected
credentials:
  - env: GH_TOKEN
    source: "gh auth token"
---

# GitHub

## Authentication

CLI-based via `gh`. Preferred over Pipedream for GitHub — the CLI handles auth, pagination, rate limits, and output formatting natively.

```bash
# Interactive login (use PTY):
gh auth login

# Or set a token directly:
export GH_TOKEN="ghp_..."
```

## Usage

### Repositories

```bash
gh repo list [owner]
gh repo clone owner/repo
gh repo create name --public
gh repo view owner/repo
```

### Pull Requests

```bash
gh pr list
gh pr create --title "..." --body "..."
gh pr view 123
gh pr merge 123
gh pr checks 123
```

### Issues

```bash
gh issue list
gh issue create --title "..." --body "..."
gh issue view 42
gh issue close 42
```

### Actions / CI

```bash
gh run list
gh run view 12345
gh run watch 12345
```

### API (anything not covered by subcommands)

```bash
gh api /repos/{owner}/{repo}/releases
gh api /user/repos --paginate
gh api graphql -f query='...'
```

## Verification

```bash
gh auth status
```

Should show: `Logged in to github.com as <username>`.
