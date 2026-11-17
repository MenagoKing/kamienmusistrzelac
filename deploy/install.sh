#!/usr/bin/env bash
# Space Rocks — install or update on a VPS (Ubuntu / Debian), run as root:
#   PUBLIC_IP=185.235.69.42 bash install.sh /root/space-rocks-deploy.tar.gz
# Installs Node 24 if needed, unpacks the app into /opt/space-rocks, keeps data in /var/lib/space-rocks,
# runs it as a systemd service on port 3000 and puts nginx in front on port 80.
# Safe to run again for updates: data, .env and the Solana authority key are kept.
set -euo pipefail

ARCHIVE="${1:-/root/space-rocks-deploy.tar.gz}"
APP=/opt/space-rocks
DATA=/var/lib/space-rocks
PORT=3000
IP="${PUBLIC_IP:-$(hostname -I | awk '{print $1}')}"

[ "$(id -u)" = 0 ] || { echo "Run as root (sudo -i)"; exit 1; }
[ -f "$ARCHIVE" ] || { echo "Archive not found: $ARCHIVE"; exit 1; }

echo "==> System packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates nginx openssl >/dev/null

need_node=1
if command -v node >/dev/null 2>&1; then
  v="$(node -p 'process.versions.node')"
  major="${v%%.*}"; rest="${v#*.}"; minor="${rest%%.*}"
  if [ "$major" -gt 22 ] || { [ "$major" -eq 22 ] && [ "$minor" -ge 18 ]; }; then need_node=0; fi
fi
if [ "$need_node" = 1 ]; then
  echo "==> Installing Node.js 24"
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
echo "    node $(node -v)"

echo "==> App files"
id spacerocks >/dev/null 2>&1 || useradd --system --home "$APP" --shell /usr/sbin/nologin spacerocks
mkdir -p "$APP" "$DATA"
# Replace the code, keep .env
find "$APP" -mindepth 1 -maxdepth 1 ! -name .env ! -name node_modules -exec rm -rf {} +
tar -xzf "$ARCHIVE" -C "$APP"
cd "$APP"
npm ci --omit=dev --no-audit --no-fund --loglevel=error

if [ ! -f "$APP/.env" ]; then
  echo "==> Creating $APP/.env"
  ADMIN_PW="$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-20)"
  cat > "$APP/.env" <<EOF
PORT=$PORT
DATA_DIR=$DATA
ADMIN_PASSWORD=$ADMIN_PW
PUBLIC_URL=http://$IP
# Plain http for now; remove this line once the site has HTTPS.
INSECURE_COOKIES=1
SOLANA_CLUSTER=devnet
GOOGLE_CLIENT_ID=
EOF
  echo "    Admin password: $ADMIN_PW   (also in $APP/.env)"
fi
chmod 600 "$APP/.env"
chown -R spacerocks:spacerocks "$APP" "$DATA"

echo "==> systemd service"
cat > /etc/systemd/system/space-rocks.service <<EOF
[Unit]
Description=Space Rocks
After=network-online.target
Wants=network-online.target

[Service]
User=spacerocks
WorkingDirectory=$APP
Environment=NODE_ENV=production
ExecStart=$(command -v node) --env-file-if-exists=$APP/.env server/index.ts
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable space-rocks >/dev/null 2>&1
systemctl restart space-rocks

echo "==> nginx on port 80"
cat > /etc/nginx/sites-available/space-rocks <<EOF
server {
  listen 80 default_server;
  listen [::]:80 default_server;
  server_name _;
  client_max_body_size 12m;
  location / {
    proxy_pass http://127.0.0.1:$PORT;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }
}
EOF
ln -sf /etc/nginx/sites-available/space-rocks /etc/nginx/sites-enabled/space-rocks
rm -f /etc/nginx/sites-enabled/default
nginx -t -q && systemctl reload nginx
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q active; then ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; fi

echo "==> Waiting for the app"
for i in $(seq 1 30); do
  if curl -fsS -o /dev/null "http://127.0.0.1:$PORT/api/page"; then ok=1; break; fi
  sleep 1
done
if [ "${ok:-0}" = 1 ]; then
  echo
  echo "Space Rocks is live:  http://$IP"
  echo "Admin panel:          http://$IP/admin"
  echo "Logs:                 journalctl -u space-rocks -f"
  echo "Solana authority (fund it on devnet at faucet.solana.com): see Admin > Solana NFTs"
else
  echo "The app did not answer. Check: journalctl -u space-rocks -n 80 --no-pager"
  exit 1
fi
