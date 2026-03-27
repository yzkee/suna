import { JustAVPSProvider } from '../src/platform/providers/justavps';
import { execOnHost } from '../src/update/exec';

const externalId = process.argv[2];

if (!externalId) {
  console.error('Usage: bun run scripts/apply-justavps-ssh-bridge.ts <external-id>');
  process.exit(1);
}

const provider = new JustAVPSProvider();
const endpoint = await provider.resolveEndpoint(externalId);

const script = `#!/bin/bash
set -euo pipefail

id -u abc >/dev/null 2>&1 || useradd -m -s /bin/bash abc
passwd -l abc >/dev/null 2>&1 || true
usermod -aG docker abc >/dev/null 2>&1 || true

cat > /usr/local/bin/kortix-authorized-keys <<'EOF'
#!/bin/bash
set -euo pipefail

USER_NAME="\${1:-}"
[ "\$USER_NAME" = "abc" ] || exit 0

docker exec justavps-workload sh -lc 'cat /config/.ssh/authorized_keys 2>/dev/null' || true
EOF
chmod +x /usr/local/bin/kortix-authorized-keys

cat > /usr/local/bin/kortix-container-shell <<'EOF'
#!/bin/bash
set -euo pipefail

TTY_ARGS=(-i)
if [ -t 0 ] && [ -t 1 ]; then
  TTY_ARGS+=(-t)
fi

if [ -n "\${SSH_ORIGINAL_COMMAND:-}" ]; then
  exec docker exec -i \
    -u abc \
    -w /workspace \
    -e HOME=/config \
    -e USER=abc \
    -e LOGNAME=abc \
    -e TERM="\${TERM:-xterm-256color}" \
    justavps-workload \
    sh -lc "\$SSH_ORIGINAL_COMMAND"
fi

exec docker exec "\${TTY_ARGS[@]}" \
  -u abc \
  -w /workspace \
  -e HOME=/config \
  -e USER=abc \
  -e LOGNAME=abc \
  -e TERM="\${TERM:-xterm-256color}" \
  justavps-workload \
  bash -l
EOF
chmod +x /usr/local/bin/kortix-container-shell

mkdir -p /etc/ssh/sshd_config.d
cat > /etc/ssh/sshd_config.d/kortix-sandbox.conf <<'EOF'
Match User abc
    PasswordAuthentication no
    PubkeyAuthentication yes
    AuthorizedKeysCommand /usr/local/bin/kortix-authorized-keys %u
    AuthorizedKeysCommandUser root
    PermitTTY yes
    X11Forwarding no
    PermitTunnel no
    GatewayPorts no
    ForceCommand /usr/local/bin/kortix-container-shell
EOF

systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || true
`;

const scriptB64 = Buffer.from(script).toString('base64');
const result = await execOnHost(
  endpoint,
  `printf '%s' '${scriptB64}' | base64 -d > /tmp/kortix-ssh-bridge.sh && bash /tmp/kortix-ssh-bridge.sh`,
  60,
);

if (!result.success) {
  console.error(result.stderr || result.stdout || 'Failed to apply SSH bridge');
  process.exit(result.exitCode || 1);
}

console.log('SSH bridge applied');
