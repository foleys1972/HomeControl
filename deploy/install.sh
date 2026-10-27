#!/usr/bin/env bash
# First install / privileged update on the server (needs your sudo password). Run by push.sh --first-install:
#   sudo bash /tmp/home-control-install.sh /tmp/home-control-deploy-<n>.tgz <deploy-user>
# Installs the service user, systemd unit, LAN-only nginx site, the deploy helper and its sudo rule, then the app.
# Routine updates (bash deploy/push.sh) only swap app code and never touch these root-owned files.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "run with sudo" >&2; exit 1; }
PKG="$1"
DEPLOY_USER="${2:-${SUDO_USER:?pass the deploy user as the second argument}}"

id homectl >/dev/null 2>&1 || useradd --system --home-dir /var/lib/home-control --shell /usr/sbin/nologin homectl
install -d -o homectl -g homectl -m 700 /var/lib/home-control

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
tar -xzf "$PKG" -C "$TMP" deploy

# systemd unit (keep the template so the helper can tell when it changes)
install -d /usr/local/share/home-control
install -m 644 "$TMP/deploy/home-control.service" /usr/local/share/home-control/home-control.service.src
NODE="$(readlink -f /usr/local/bin/node 2>/dev/null || command -v node)"
sed "s#@NODE@#$NODE#" "$TMP/deploy/home-control.service" > /etc/systemd/system/home-control.service
systemctl daemon-reload

# nginx: LAN-only site at http://<this server's LAN IP> (port 80, by IP; other sites answer only to their own names)
LAN_IP="$(ip -4 route get 1.1.1.1 | awk '{for (i = 1; i < NF; i++) if ($i == "src") print $(i + 1)}')"
ROUTER_IP="$(ip -4 route show default | awk '{print $3; exit}')"
LAN_NET="$(ip -4 -o addr show | awk -v ip="$LAN_IP" '$4 ~ "^"ip"/" {print $4; exit}')"
[ -n "$LAN_IP" ] && [ -n "$ROUTER_IP" ] && [ -n "$LAN_NET" ] || { echo "could not work out the LAN address, network and router" >&2; exit 1; }
sed -e "s#@LAN_IP@#$LAN_IP#" -e "s#@ROUTER_IP@#$ROUTER_IP#" -e "s#@LAN_NET@#$LAN_NET#" "$TMP/deploy/nginx-home-control.conf" > /etc/nginx/sites-available/home-control.conf
chmod 644 /etc/nginx/sites-available/home-control.conf
ln -sf /etc/nginx/sites-available/home-control.conf /etc/nginx/sites-enabled/home-control.conf
nginx -t
systemctl reload nginx

# deploy helper + password-free sudo rule for it only
install -m 755 "$TMP/deploy/home-control-deploy" /usr/local/sbin/home-control-deploy
echo "$DEPLOY_USER ALL=(root) NOPASSWD: /usr/local/sbin/home-control-deploy" > /etc/sudoers.d/home-control.tmp
chmod 440 /etc/sudoers.d/home-control.tmp
visudo -cf /etc/sudoers.d/home-control.tmp >/dev/null
mv /etc/sudoers.d/home-control.tmp /etc/sudoers.d/home-control

chown "$DEPLOY_USER" "$PKG"
SUDO_USER="$DEPLOY_USER" /usr/local/sbin/home-control-deploy "$PKG"
systemctl enable home-control >/dev/null 2>&1
echo "Done. Open http://$LAN_IP from a device on the home network."
