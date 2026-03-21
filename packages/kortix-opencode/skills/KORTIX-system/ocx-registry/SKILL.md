---
name: ocx-registry
description: "OCX registry reference: skill discovery, keyword matching, preview, installation, and loading workflow."
---

# OCX Registry — Skill Discovery & Installation

Find, evaluate, and install marketplace skills via the Kortix OCX registry.

---

## Registry Endpoint

```
https://master.kortix-registry.pages.dev/index.json          # Full index
https://master.kortix-registry.pages.dev/skills/<name>/SKILL.md  # Individual skill
```

---

## Workflow

### 1. Check if already installed

```bash
ls .opencode/skills/ 2>/dev/null || echo "No skills installed yet"
```

### 2. Fetch the registry

```bash
curl -s https://master.kortix-registry.pages.dev/index.json | python3 -c "
import json, sys
for c in json.load(sys.stdin).get('components', []):
    print(f\"  {c['name']:40} {c.get('description','')}\")
"
```

### 3. Search by keyword

```bash
QUERY="browser"
curl -s https://master.kortix-registry.pages.dev/index.json | python3 -c "
import json, sys
q = '${QUERY}'.lower()
for c in json.load(sys.stdin).get('components', []):
    if q in c['name'].lower() or q in c.get('description','').lower():
        print(f\"  {c['name']:40} {c.get('description','')}\")
"
```

### 4. Preview before installing

```bash
curl -s https://master.kortix-registry.pages.dev/skills/<name>/SKILL.md | head -60
```

### 5. Install

```bash
ocx add kortix/<skill-name>
```

### 6. Load immediately

```
skill("<skill-name>")
```

---

## Semantic Matching Table

| User says | Best match |
|---|---|
| "browse websites", "click", "fill forms", "screenshot" | `agent-browser` |
| "read/write PDF" | `pdf` |
| "Word documents", "docx" | `docx` |
| "spreadsheet", "Excel", "CSV" | `xlsx` |
| "research topic deeply", "multi-source report" | `deep-research` |
| "presentation", "slides" | `presentations` |
| "video", "animation" | `remotion` |
| "text-to-speech", "voice" | `elevenlabs` |
| "email", "send mail", "IMAP" | `email` |
| "domain", "WHOIS", "DNS" | `domain-research` |
| "legal document", "contract" | `legal-writer` |
| "logo", "brand design" | `logo-creator` |
| "academic paper", "citation" | `openalex-paper-search` |
| "LaTeX paper", "scientific writing" | `paper-creator` |
| "AI model", "image generation", "Replicate" | `replicate` |
| "agent forum", "knowledge sharing" | `woa` |
| "full-stack", "React", "Convex" | `fullstack-vite-convex` |

---

## Available Registry Skills

| Skill | Description |
|---|---|
| `deep-research` | Comprehensive multi-source research reports |
| `docx` | Word document creation and editing |
| `domain-research` | Domain availability checking and WHOIS |
| `elevenlabs` | Text-to-speech and voice cloning |
| `email` | IMAP/SMTP email sending and receiving |
| `fullstack-vite-convex` | Full-stack React + Convex development |
| `legal-writer` | Legal document drafting |
| `logo-creator` | Professional logo and brand design |
| `openalex-paper-search` | Academic paper search via OpenAlex |
| `paper-creator` | Scientific paper writing in LaTeX |
| `pdf` | PDF reading, creation, manipulation, OCR |
| `remotion` | Video creation in React |
| `replicate` | AI model inference via Replicate API |
| `woa` | WoA (Wisdom of Agents) — internal agent forum |
| `xlsx` | Spreadsheet, CSV, and Excel processing |

---

## Decision Logic

1. **Check if installed** → `ls .opencode/skills/`
2. **Not installed** → match to registry (table above)
3. **Ambiguous** → fetch live index and keyword-search
4. **Confirm** → preview SKILL.md if needed
5. **Install** → `ocx add kortix/<name>`
6. **Load** → `skill("<name>")`
7. **Proceed** with the original task
