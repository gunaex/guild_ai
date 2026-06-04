# Autostart

Guild AI can start automatically when the machine boots.

## Recommended Modes

Notebook/local development:

```bash
bash scripts/install-autostart.sh
```

This installs two user services:

- `guild-ai-server.service`
- `guild-ai-web.service`

Check status:

```bash
systemctl --user status guild-ai-server.service
systemctl --user status guild-ai-web.service
```

Stop temporarily:

```bash
systemctl --user stop guild-ai-web.service guild-ai-server.service
```

Start again:

```bash
systemctl --user start guild-ai-server.service guild-ai-web.service
```

Remove autostart:

```bash
bash scripts/uninstall-autostart.sh
```

## Start Before Login

By default, user services may start after the user logs in. To start Guild AI at boot before desktop login:

```bash
sudo loginctl enable-linger $USER
```

This is useful for an Ubuntu notebook that should wake up and serve Guild AI without manual terminal commands.

## Docker Server Mode

For an AI server, Docker Compose is usually cleaner.

```bash
cp .env.server .env
docker compose up --build -d
```

The compose services use `restart: unless-stopped`, so they come back when Docker starts after reboot.

If you want systemd to manage the whole Docker stack, copy `deploy/systemd/guild-ai-docker.service` to `/etc/systemd/system/`, adjust `WorkingDirectory=/opt/guild-ai`, then enable it:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now guild-ai-docker.service
```

## LAN And Internet Notes

Before exposing Guild AI beyond this machine, open the Guild AI panel and check `Deployment readiness`.

For LAN use:

- Set a strong `API_AUTH_TOKEN` before exposing non-local access.
- Keep `.env` private.
- Restrict access with firewall rules.
- Configure `ALLOWED_ORIGINS` or `ALLOWED_ORIGIN_SUFFIXES`.
- Prefer production static serving over Vite dev mode for long-running service.

For internet use:

- Do not expose Vite or the raw Node server directly.
- Put Guild AI behind an HTTPS reverse proxy.
- Use auth on all admin/API routes.
- Back up SQLite and optional ChromaDB volumes.
- Set `GUILD_AI_HTTPS_PROXY=1` only after HTTPS reverse proxy, firewall, and auth are actually in place.
