---
name: cli-maxxing
description: "CLI Maxxing: Always prefer CLIs over APIs, GUIs, or manual steps. Use PTY tools for any interactive CLI that needs a TTY (auth flows, prompts, confirmations, wizards). Covers interactive authentication (gh, gcloud, aws, npm, docker), PTY-first workflow patterns, and CLI discovery for any task. Triggers on: 'authenticate', 'login', 'interactive', 'CLI', 'terminal', 'TTY', 'pty', 'gh auth', 'npm login', 'docker login', 'gcloud auth', 'aws configure', or any task where a CLI tool exists."
---

# CLI Maxxing

**Core principle: If a CLI exists for it, use the CLI.** Don't build around it. Don't use a REST API when `gh` handles it. Don't paste tokens when `gh auth login` does device flow. Don't write HTTP requests when `curl` or `httpie` already does it. CLIs are built by the people who made the service — they handle auth, pagination, retries, and output formatting better than hand-rolled alternatives.

## The PTY Rule

**Any CLI that needs interactive input MUST use PTY tools, not `bash`.** The `bash` tool runs commands synchronously and cannot handle TTY prompts — they hang forever.

### When to use PTY vs Bash

| Scenario | Tool | Why |
|---|---|---|
| `gh auth login` (device flow) | **PTY** | Prompts for choices, opens browser, waits for callback |
| `npm login` | **PTY** | Prompts for username/password/OTP |
| `docker login` | **PTY** | Prompts for password on stdin |
| `gcloud auth login` | **PTY** | Opens browser, waits for OAuth callback |
| `aws configure` | **PTY** | Prompts for access key, secret, region, format |
| `ssh-keygen` | **PTY** | Prompts for passphrase |
| `git credential approve` | **PTY** | Reads from stdin interactively |
| `npx create-next-app` | **PTY** | Interactive wizard with choices |
| `terraform apply` | **PTY** | Prompts for "yes" confirmation |
| `git rebase` (non-interactive) | Bash | No TTY needed |
| `gh pr list` | Bash | Pure output, no interaction |
| `curl -X POST ...` | Bash | No interaction |
| `npm install` | Bash | Non-interactive (unless auth needed) |

**Rule of thumb:** If the command _might_ prompt for input, use PTY. When in doubt, use PTY — it handles both interactive and non-interactive commands fine.

## PTY Interactive Workflow Pattern

Every interactive CLI follows this pattern:

```
1. pty_spawn  →  Start the command in a PTY
2. pty_read   →  Read output, find the prompt
3. pty_write  →  Send the response
4. pty_read   →  Check result, repeat if more prompts
5. pty_kill   →  Clean up when done (or let it exit naturally)
```

### Example: GitHub CLI Authentication

```bash
# 1. Spawn the auth flow
pty_spawn: command="gh", args=["auth", "login"], title="GitHub Auth"

# 2. Read the first prompt (account type selection)
pty_read → "? What account do you want to log into? [GitHub.com / GitHub Enterprise]"

# 3. Send selection
pty_write: "1\n"  # or arrow keys + enter

# 4. Read next prompt (auth method)
pty_read → "? How would you like to authenticate? [Login with a web browser / Paste an authentication token]"

# 5. Send selection
pty_write: "1\n"  # web browser

# 6. Read the device code
pty_read → "! First copy your one-time code: XXXX-XXXX"

# 7. Show the code to the user
show: "Your GitHub device code is: XXXX-XXXX — press Enter in the browser to complete auth"

# 8. Send Enter to open browser (or wait)
pty_write: "\n"

# 9. Poll for completion
pty_read → "✓ Authentication complete."

# 10. Clean up
pty_kill: cleanup=true
```

### Example: npm Login

```bash
pty_spawn: command="npm", args=["login"], title="npm Login"
pty_read  → "Username:"
pty_write: "myuser\n"
pty_read  → "Password:"
pty_write: "mypass\n"
pty_read  → "Email:"
pty_write: "me@example.com\n"
pty_read  → "Enter one-time password from your authenticator app:"
# Ask the user for their OTP
question: "What's your npm 2FA code?"
pty_write: "<user_response>\n"
pty_read  → "Logged in as myuser"
pty_kill: cleanup=true
```

### Example: Interactive Project Scaffolding

```bash
pty_spawn: command="npx", args=["create-next-app@latest", "my-app"], title="Create Next App"
pty_read  → "Would you like to use TypeScript? (Y/n)"
pty_write: "Y\n"
pty_read  → "Would you like to use ESLint? (Y/n)"
pty_write: "Y\n"
pty_read  → "Would you like to use Tailwind CSS? (Y/n)"
pty_write: "Y\n"
# ... continue until done
pty_read  → "Success! Created my-app"
pty_kill: cleanup=true
```

## CLI Discovery Hierarchy

When facing any task, check for CLIs in this order:

1. **Already installed:** `which <tool>` or `command -v <tool>` — check what's available first
2. **Package managers:** `brew install`, `apt install`, `npm install -g`, `pip install`
3. **npx/bunx one-shot:** `npx <tool>` — many tools work without global install
4. **Direct download:** `curl -sL <url> | tar xz` — for standalone binaries
5. **Docker:** `docker run <image>` — when the tool has complex deps

### Common CLI Tools by Domain

| Domain | CLI | Install | Interactive Auth? |
|---|---|---|---|
| GitHub | `gh` | `brew install gh` | Yes — `gh auth login` (device flow) |
| Google Cloud | `gcloud` | `brew install google-cloud-sdk` | Yes — `gcloud auth login` (browser) |
| AWS | `aws` | `brew install awscli` | Yes — `aws configure` (prompts) |
| Azure | `az` | `brew install azure-cli` | Yes — `az login` (browser) |
| Docker Hub | `docker` | Pre-installed | Yes — `docker login` (password) |
| npm Registry | `npm` | Pre-installed | Yes — `npm login` (username/pass/OTP) |
| Vercel | `vercel` | `npm i -g vercel` | Yes — `vercel login` (email/browser) |
| Netlify | `netlify` | `npm i -g netlify-cli` | Yes — `netlify login` (browser) |
| Fly.io | `flyctl` | `brew install flyctl` | Yes — `fly auth login` (browser) |
| Railway | `railway` | `npm i -g @railway/cli` | Yes — `railway login` (browser) |
| Supabase | `supabase` | `brew install supabase/tap/supabase` | Yes — `supabase login` |
| Firebase | `firebase` | `npm i -g firebase-tools` | Yes — `firebase login` (browser) |
| Terraform | `terraform` | `brew install terraform` | No (uses env vars) |
| Kubernetes | `kubectl` | `brew install kubectl` | Depends on provider |
| Stripe | `stripe` | `brew install stripe/stripe-cli/stripe` | Yes — `stripe login` (browser) |
| Twilio | `twilio` | `npm i -g twilio-cli` | Yes — `twilio login` (prompts) |
| Heroku | `heroku` | `brew install heroku` | Yes — `heroku login` (browser) |
| SSH | `ssh-keygen`, `ssh` | Pre-installed | Yes — passphrase prompts |
| GPG | `gpg` | `brew install gnupg` | Yes — passphrase prompts |

## PTY Anti-Patterns

### DON'T: Use bash for interactive commands
```bash
# WRONG — will hang forever
bash: gh auth login
bash: npm login
bash: read -p "Enter value: " val
```

### DON'T: Use sleep to poll PTY
```bash
# WRONG — wasteful and fragile
pty_spawn ...
bash: sleep 2        # Don't do this!
pty_read ...
```
PTY output is buffered. Just `pty_read` — if output isn't there yet, read again after a moment. No `sleep` needed.

### DON'T: Pipe secrets through command args
```bash
# WRONG — visible in process list
pty_spawn: command="npm", args=["login", "--password=secret"]

# RIGHT — send via PTY stdin
pty_spawn: command="npm", args=["login"]
pty_write: "secret\n"  # Goes through PTY stdin, not visible in ps
```

### DON'T: Skip the CLI and go straight to APIs
```bash
# WRONG — reinventing what gh already does
curl -H "Authorization: token $TOKEN" https://api.github.com/repos/...

# RIGHT — let the CLI handle auth, pagination, output
gh api repos/owner/name
gh pr list --json number,title,author
```

## When the User Needs to Participate

Some auth flows require the user to act (open a browser, enter a code, approve a prompt). Use the `question` tool or `show` tool to communicate:

1. **Device codes:** Show the code via `show` tool, tell user to enter it in the browser
2. **Browser auth:** Tell user a browser will open (or provide the URL if headless)
3. **2FA/OTP:** Use `question` tool to ask for the code
4. **Approval prompts:** Show what will happen, ask for confirmation before sending "yes"

## Verification

After any CLI auth flow, always verify it worked:

```bash
# GitHub
gh auth status

# npm  
npm whoami

# Docker
docker info

# gcloud
gcloud auth list

# AWS
aws sts get-caller-identity

# Vercel
vercel whoami
```

If verification fails, don't silently proceed — report the failure and retry or ask the user.

## Environment Setup Pattern

When a task needs a CLI that isn't installed:

1. Check if it exists: `which <tool>` via bash
2. If missing, install it: `brew install <tool>` or `npm install -g <tool>` via bash
3. Verify install: `<tool> --version` via bash
4. If auth needed: PTY spawn the auth flow
5. Verify auth: Run a simple authenticated command via bash
6. Proceed with the actual task

Always prefer the user's package manager. On macOS: `brew`. On Linux: `apt` / package manager available. For Node tools: `npm -g` or `npx`.
