#!/usr/bin/env bash
# Space Rocks — install or update on a VPS (Ubuntu / Debian), run as root:
#   PUBLIC_IP=185.235.69.42 bash install.sh /root/space-rocks-deploy.tar.gz
#   DOMAIN=example.com PUBLIC_IP=… bash install.sh …   (adds HTTPS with Let's Encrypt; remembered for updates)
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
# Mainnet settings (the site starts on devnet; switch in Admin > Network). The encryption key for
# collectors' mainnet wallets lives here, apart from the data folder: back up this file.
if ! grep -q '^CUSTODY_KEY_MAINNET=' "$APP/.env" && [ ! -f "$DATA/mainnet/custody-key.bin" ]; then
  cat >> "$APP/.env" <<EOF

# --- mainnet (see README: Devnet and mainnet) ---
CUSTODY_KEY_MAINNET=$(openssl rand -hex 32)
# A dedicated RPC for mainnet (Helius, Triton, QuickNode). The public one is rate-limited.
# SOLANA_RPC_MAINNET=https://mainnet.helius-rpc.com/?api-key=...
# Set PUBLIC_URL to your https domain before minting real NFTs, e.g. PUBLIC_URL=https://spacerocks.example
EOF
  echo "    Generated CUSTODY_KEY_MAINNET in $APP/.env (back up this file)"
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

# Domain and HTTPS: run once with DOMAIN=example.com (optionally EMAIL=you@example.com for Let's
# Encrypt expiry notices). The domain is remembered in .env, so later updates keep HTTPS.
DOMAIN="${DOMAIN:-$(grep -s '^DOMAIN=' "$APP/.env" | cut -d= -f2- || true)}"
DOMAIN="${DOMAIN#http*://}"; DOMAIN="${DOMAIN%%/*}"
SITE="http://$IP"

proxy_block() {
  cat <<EOF
  client_max_body_size 12m;
  location / {
    proxy_pass http://127.0.0.1:$PORT;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }
EOF
}
reload_nginx() {
  ln -sf /etc/nginx/sites-available/space-rocks /etc/nginx/sites-enabled/space-rocks
  rm -f /etc/nginx/sites-enabled/default
  nginx -t -q && systemctl reload nginx
}
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q active; then ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; fi

if [ -z "$DOMAIN" ]; then
  echo "==> nginx on port 80"
  { echo "server {"; echo "  listen 80 default_server;"; echo "  listen [::]:80 default_server;"; echo "  server_name _;"; proxy_block; echo "}"; } > /etc/nginx/sites-available/space-rocks
  reload_nginx
else
  echo "==> nginx for $DOMAIN"
  if grep -q '^DOMAIN=' "$APP/.env"; then sed -i "s#^DOMAIN=.*#DOMAIN=$DOMAIN#" "$APP/.env"; else echo "DOMAIN=$DOMAIN" >> "$APP/.env"; fi
  mkdir -p /var/www/certbot
  resolve() { getent ahostsv4 "$1" | awk '{print $1; exit}'; }
  NAMES="$DOMAIN"
  [ "$(resolve "www.$DOMAIN")" = "$IP" ] && NAMES="$DOMAIN www.$DOMAIN"
  CERT="/etc/letsencrypt/live/$DOMAIN/fullchain.pem"
  # Plain http first (it answers Let's Encrypt's check), unless a certificate already exists.
  if [ ! -f "$CERT" ]; then
    { echo "server {"; echo "  listen 80 default_server;"; echo "  listen [::]:80 default_server;"; echo "  server_name $NAMES _;"
      echo "  location /.well-known/acme-challenge/ { root /var/www/certbot; }"; proxy_block; echo "}"; } > /etc/nginx/sites-available/space-rocks
    reload_nginx
  fi
  if [ "$(resolve "$DOMAIN")" != "$IP" ]; then
    echo "    $DOMAIN does not point to $IP yet (found: $(resolve "$DOMAIN" || true))."
    echo "    Add an A record for $DOMAIN -> $IP at your domain registrar, wait a few minutes, then run this again."
  else
    echo "==> HTTPS certificate (Let's Encrypt) for: $NAMES"
    apt-get install -y -qq certbot >/dev/null
    if [ -n "${EMAIL:-}" ]; then ACCOUNT="-m $EMAIL"; else ACCOUNT="--register-unsafely-without-email"; fi
    # shellcheck disable=SC2086
    certbot certonly --webroot -w /var/www/certbot $(for n in $NAMES; do printf -- '-d %s ' "$n"; done) \
      --non-interactive --agree-tos $ACCOUNT --keep-until-expiring --expand --deploy-hook "systemctl reload nginx" \
      || echo "    Certificate request failed: the site stays on http for now. Check DNS and that port 80 is open, then run this again."
  fi
  if [ -f "$CERT" ]; then
    {
      echo "server {"; echo "  listen 80 default_server;"; echo "  listen [::]:80 default_server;"; echo "  server_name $NAMES _;"
      echo "  location /.well-known/acme-challenge/ { root /var/www/certbot; }"
      echo "  location / { return 301 https://$DOMAIN\$request_uri; }"
      echo "}"
      echo "server {"; echo "  listen 443 ssl http2;"; echo "  listen [::]:443 ssl http2;"; echo "  server_name $NAMES;"
      echo "  ssl_certificate $CERT;"; echo "  ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;"
      echo "  ssl_protocols TLSv1.2 TLSv1.3;"; echo "  ssl_session_cache shared:SSL:10m;"
      proxy_block; echo "}"
    } > /etc/nginx/sites-available/space-rocks
    reload_nginx
    # The app now lives at https://DOMAIN: NFT links use it, cookies are Secure.
    if grep -q '^PUBLIC_URL=' "$APP/.env"; then sed -i "s#^PUBLIC_URL=.*#PUBLIC_URL=https://$DOMAIN#" "$APP/.env"; else echo "PUBLIC_URL=https://$DOMAIN" >> "$APP/.env"; fi
    sed -i '/^INSECURE_COOKIES=/d; /^# Plain http for now/d' "$APP/.env"
    systemctl restart space-rocks
    SITE="https://$DOMAIN"
  fi
fi

echo "==> Waiting for the app"
for i in $(seq 1 30); do
  if curl -fsS -o /dev/null "http://127.0.0.1:$PORT/api/page" 2>/dev/null; then ok=1; break; fi
  sleep 1
done
if [ "${ok:-0}" = 1 ]; then
  echo
  echo "Space Rocks is live:  $SITE"
  echo "Admin panel:          $SITE/admin"
  echo "Logs:                 journalctl -u space-rocks -f"
  echo "Solana authority (fund it on devnet at faucet.solana.com): see Admin > Solana NFTs"
else
  echo "The app did not answer. Check: journalctl -u space-rocks -n 80 --no-pager"
  exit 1
fi
