#!/usr/bin/env bash
# Quick auth flow test - assumes containers are already running

set -e

FRONTEND_URL="http://localhost:13737"
SUPABASE_URL="http://localhost:13740"
INSTALL_DIR="$HOME/.kortix"

echo "Testing auth flow..."

# Get credentials
if [ -f "$INSTALL_DIR/.credentials" ]; then
    OWNER_EMAIL=$(grep "Email:" "$INSTALL_DIR/.credentials" | cut -d: -f2 | tr -d ' ')
    OWNER_PASSWORD=$(grep "Password:" "$INSTALL_DIR/.credentials" | cut -d: -f2 | tr -d ' ')
else
    OWNER_EMAIL="marko@kortix.ai"
    OWNER_PASSWORD="password1112"
fi

ANON_KEY=$(grep -m1 '^SUPABASE_ANON_KEY=' "$INSTALL_DIR/.env" | cut -d= -f2-)

echo "Signing in as $OWNER_EMAIL..."

# Sign in
SESSION=$(curl -sf "$SUPABASE_URL/auth/v1/token?grant_type=password" \
    -H "apikey: $ANON_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$OWNER_EMAIL\",\"password\":\"$OWNER_PASSWORD\"}")

# Create cookie
COOKIE=$(python3 -c "
import json, urllib.parse
s = json.loads('''$SESSION''')
print(urllib.parse.quote(json.dumps(s, separators=(',', ':')), safe=''))
")

# Test dashboard
echo "Testing /dashboard access..."
HTTP_CODE=$(curl -s "$FRONTEND_URL/dashboard" \
    -H "Cookie: sb-kortix-auth-token.0=$COOKIE" \
    -o /dev/null -w "%{http_code}")

if [ "$HTTP_CODE" = "200" ]; then
    echo "✅ Auth flow working - dashboard accessible"
    exit 0
else
    echo "❌ Auth failed - HTTP $HTTP_CODE"
    exit 1
fi
