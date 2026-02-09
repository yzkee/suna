#!/bin/bash
set -e

if [ "$ENV_MODE" = "cloud" ] || [ "$ENV_MODE" = "production" ]; then
    echo "[Kortix] Cloud mode — enabling API proxy DNS interception"

    # Point container DNS to local dnsmasq
    echo "nameserver 127.0.0.1" > /etc/resolv.conf

    # Override SDK base URLs to route through Kortix router
    # KORTIX_ROUTER_URL is passed as env var (e.g. https://router-api.kortix.com)
    if [ -n "$KORTIX_ROUTER_URL" ]; then
        export TAVILY_API_URL="${KORTIX_ROUTER_URL}/tavily"
        export SERPER_API_URL="${KORTIX_ROUTER_URL}/serper"
        export FIRECRAWL_API_URL="${KORTIX_ROUTER_URL}/firecrawl"
        export REPLICATE_API_URL="${KORTIX_ROUTER_URL}/replicate"
        export CONTEXT7_API_URL="${KORTIX_ROUTER_URL}/context7"
        echo "[Kortix] SDK URLs routed through ${KORTIX_ROUTER_URL}"
    fi
else
    echo "[Kortix] Local mode — DNS interception disabled"

    # Remove dnsmasq config so it starts idle (no overrides)
    rm -f /etc/dnsmasq.d/kortix-proxy.conf
fi

# Start supervisord (manages kortix-master, opencode, dnsmasq)
exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf
