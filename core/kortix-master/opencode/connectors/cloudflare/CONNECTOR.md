---
name: cloudflare
description: "Cloudflare DNS, Workers, Pages, R2, and domain management via wrangler CLI and API"
type: api-key
status: disconnected
credentials:
  - env: CLOUDFLARE_API_TOKEN
    source: "https://dash.cloudflare.com/profile/api-tokens"
    required: true
  - env: CLOUDFLARE_ACCOUNT_ID
    source: "Dashboard → Overview → right sidebar"
    required: false
---

# Cloudflare

## Authentication

API token from the Cloudflare dashboard. Create a token with appropriate permissions at:
https://dash.cloudflare.com/profile/api-tokens

```bash
# Save via Kortix secrets manager:
curl -s -X POST "http://localhost:8000/env/CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"value":"your-token-here","restart":true}'

# Optional: account ID for Workers/R2
curl -s -X POST "http://localhost:8000/env/CLOUDFLARE_ACCOUNT_ID" \
  -H "Content-Type: application/json" \
  -d '{"value":"your-account-id","restart":true}'
```

### CLI alternative (wrangler)

```bash
# Install
npm i -g wrangler

# Login (interactive — use PTY)
wrangler login
```

## Usage

### DNS

```bash
# List zones
curl -s -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/zones"

# List DNS records
curl -s -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_records"
```

### Workers (via wrangler)

```bash
wrangler deploy
wrangler dev
wrangler tail
```

### Pages

```bash
wrangler pages deploy ./dist --project-name=my-project
```

### R2

```bash
wrangler r2 object put bucket/key --file=./file.txt
wrangler r2 object get bucket/key
```

## Verification

```bash
curl -s -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/user/tokens/verify" | jq .success
```

Should return `true`.
