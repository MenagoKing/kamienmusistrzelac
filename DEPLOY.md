# Deploy to a VPS

Ubuntu or Debian, root access. The installer sets up Node 24, the app as a systemd service on port 3000, and nginx on port 80.

## First time and every update

On your computer, in the project folder:

```
bash deploy/pack.sh
scp space-rocks-deploy.tar.gz root@185.235.69.42:/root/
```

On the server:

```
ssh root@185.235.69.42
tar -xzf /root/space-rocks-deploy.tar.gz -C /root deploy/install.sh
PUBLIC_IP=185.235.69.42 bash /root/deploy/install.sh /root/space-rocks-deploy.tar.gz
```

The first run prints the admin password (also in `/opt/space-rocks/.env`). Updates keep the database, uploads, `.env` and the Solana authority key.

- Site: `http://185.235.69.42`, admin: `http://185.235.69.42/admin`
- Code: `/opt/space-rocks`, data: `/var/lib/space-rocks` (back up `solana-authority.json` and `space-rocks.db`)
- Logs: `journalctl -u space-rocks -f`, restart: `systemctl restart space-rocks`
- Settings: edit `/opt/space-rocks/.env`, then `systemctl restart space-rocks`

## After it is live

- NFTs: the server generates its own vault authority. Copy its address from Admin › Solana NFTs and fund it on devnet at https://faucet.solana.com.
- Google sign-in needs a domain with HTTPS (Google does not accept a bare IP as an origin). Point a domain at the server, add HTTPS (`apt install certbot python3-certbot-nginx && certbot --nginx -d yourdomain`), set `PUBLIC_URL=https://yourdomain` and remove `INSECURE_COOKIES=1` in `.env`, then add the client ID in Admin › Rules & settings.
