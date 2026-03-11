# Kortix E2E Tests

## Test Suite Overview

### 1. Full Install Test (`e2e/test-self-hosted-install.sh`)
Complete end-to-end test from clean state to working dashboard:
- Cleans existing installation
- Runs get-kortix.sh installer
- Verifies all containers start
- Tests auth flow
- Tests protected routes
- Verifies dashboard loads

**Usage:**
```bash
bash tests/e2e/test-self-hosted-install.sh
```

**Duration:** ~3-5 minutes

### 2. Quick Auth Test (`e2e/test-auth-flow.sh`)
Fast test assuming containers are already running:
- Tests sign-in API
- Tests dashboard access with cookie

**Usage:**
```bash
bash tests/e2e/test-auth-flow.sh
```

**Duration:** ~5 seconds

## Running Tests

### Option 1: Full Test (Clean Install)
```bash
# From repo root
bash tests/e2e/test-self-hosted-install.sh
```

### Option 2: Quick Test (Existing Install)
```bash
# Make sure containers are running first
kortix start

# Then run quick test
bash tests/e2e/test-auth-flow.sh
```

### Option 3: Manual Verification
```bash
# Check containers
docker ps | grep kortix

# Check auth curl -sf http://localhost:13740/auth/v1/health

# Check dashboard
curl -sf http://localhost:13737/auth -o /dev/null && echo "Frontend OK"
```

## What Tests Verify

✅ **Containers**: All 6 containers start and stay running
✅ **Networking**: Ports 13737, 13738, 13740, 13741 accessible  
✅ **Auth API**: Supabase GoTrue responds to sign-in
✅ **Session Cookies**: Auth tokens properly set and validated
✅ **Protected Routes**: /dashboard requires auth, returns 200 with valid session
✅ **Frontend Config**: Bundle has correct Supabase URL (not dev URLs)

## Troubleshooting

### "Invalid authentication credentials"
- Frontend bundle has wrong Supabase URL
- Check: `docker logs kortix-frontend-1 | grep "entrypoint"`
- Should show: `Supabase URL: https://placeholder.supabase.co -> http://localhost:13740`

### "HTTP 307" (redirect loop)
- Middleware can't validate session
- Check: `docker logs kortix-frontend-1 | grep -i error`

### Containers not starting
- Check port conflicts: `lsof -i :13737`
- Check Docker: `docker system info`
- Free ports: `bash scripts/free-kortix-ports.sh`
