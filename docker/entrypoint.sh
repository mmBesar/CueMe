#!/bin/sh
# Container start-up:
#  1. set the timezone from TZ
#  2. create/own the config and script folders as PUID:PGID
#  3. run the hub as that user
set -e

# Timezone
if [ -n "$TZ" ] && [ -f "/usr/share/zoneinfo/$TZ" ]; then
  ln -sf "/usr/share/zoneinfo/$TZ" /etc/localtime
  echo "$TZ" > /etc/timezone
fi

# Folders (done here, not in the Dockerfile, so mounted volumes work)
mkdir -p "$CUEME_DATA" "$CUEME_LIBRARY"
chown "$PUID:$PGID" "$CUEME_DATA" "$CUEME_LIBRARY"

# Run as the requested user. A fixed PIN can be given with CUEME_PIN.
exec su-exec "$PUID:$PGID" /usr/local/bin/cueme-serve "$@"
