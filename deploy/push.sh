#!/usr/bin/env bash
# Deploy from this PC to the server.
#   bash deploy/push.sh                  package, upload, install, verify (no password once set up)
#   bash deploy/push.sh --first-install  first time only: asks for your sudo password on the server
#   bash deploy/push.sh --status | --logs [N]
set -euo pipefail
cd "$(dirname "$0")/.."

# The SSH login lives in deploy/server.env (not in git):  DEPLOY_SERVER=user@<server-ip>
[ -f deploy/server.env ] && . deploy/server.env
SERVER="${DEPLOY_SERVER:?set DEPLOY_SERVER=user@host in deploy/server.env}"
SSH=(ssh -o BatchMode=yes -o ConnectTimeout=10)
SCP=(scp -q -o BatchMode=yes -o ConnectTimeout=10)
die() { echo "deploy: $*" >&2; exit 1; }

case "${1:-}" in
  --status) exec "${SSH[@]}" "$SERVER" sudo -n /usr/local/sbin/home-control-deploy --status ;;
  --logs)   exec "${SSH[@]}" "$SERVER" sudo -n /usr/local/sbin/home-control-deploy --logs "${2:-80}" ;;
esac

for f in src/*.js public/app.js; do node --check "$f" || die "syntax error in $f"; done

PKG="$(mktemp -t home-control.XXXXXX).tgz"
trap 'rm -f "$PKG"' EXIT
git rev-parse --short HEAD > VERSION 2>/dev/null || date +%Y%m%d-%H%M > VERSION
tar -czf "$PKG" --exclude='./data' src public deploy package.json VERSION
rm -f VERSION
REMOTE="/tmp/home-control-deploy-$$.tgz"
echo "deploy: uploading to $SERVER"
"${SCP[@]}" "$PKG" "$SERVER:$REMOTE"

if [ "${1:-}" = "--first-install" ]; then
  "${SCP[@]}" deploy/install.sh "$SERVER:/tmp/home-control-install.sh"
  echo "deploy: first install — enter your sudo password for the server when asked"
  ssh -t -o ConnectTimeout=10 "$SERVER" "sudo bash /tmp/home-control-install.sh $REMOTE \$(whoami); rm -f /tmp/home-control-install.sh"
  exit 0
fi

"${SSH[@]}" "$SERVER" sudo -n /usr/local/sbin/home-control-deploy --check >/dev/null 2>&1 \
  || die "server not set up yet — run: bash deploy/push.sh --first-install"
"${SSH[@]}" "$SERVER" sudo -n /usr/local/sbin/home-control-deploy "$REMOTE"
echo "deploy: done — http://${SERVER#*@}"
