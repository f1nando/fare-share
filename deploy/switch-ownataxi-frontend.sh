#!/usr/bin/env bash
set -euo pipefail

channel=${1:-}
target=${2:-}

case "$channel" in
  production) link=/var/www/ownataxi/production-current ;;
  rehearsal) link=/var/www/ownataxi/rehearsal-current ;;
  *) echo "Usage: $0 production|rehearsal /var/www/ownataxi/releases/<release>/<build>" >&2; exit 2 ;;
esac

case "$target" in
  /var/www/ownataxi/releases/*) ;;
  *) echo "Target must be inside /var/www/ownataxi/releases" >&2; exit 2 ;;
esac

test -f "$target/index.html"
previous=$(readlink -f "$link" 2>/dev/null || true)
next="${link}.next"
rollback="${link}.rollback"

rm -f "$next" "$rollback"
ln -s "$target" "$next"
mv -Tf "$next" "$link"

if ! nginx -t; then
  if [[ -n "$previous" ]]; then
    ln -s "$previous" "$rollback"
    mv -Tf "$rollback" "$link"
  fi
  exit 1
fi

systemctl reload nginx
printf '%s=%s\n' "${channel^^}_FRONTEND" "$target"
