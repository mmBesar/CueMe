# CueMe headless hub image.
# The binary is built (statically, with musl) by the release workflow and copied in,
# so there is nothing to compile here and it builds on every CPU type natively.
FROM alpine:3.23

# tzdata = TZ support, su-exec = run as PUID/PGID
RUN apk add --no-cache tzdata su-exec

ARG HUB_BINARY=cueme-serve
COPY ${HUB_BINARY} /usr/local/bin/cueme-serve
COPY entrypoint.sh /entrypoint.sh
RUN chmod 0755 /usr/local/bin/cueme-serve /entrypoint.sh

# Defaults (override with -e). /config holds the PIN and settings, /scripts your .md/.txt files.
ENV PUID=1000 \
    PGID=1000 \
    TZ=UTC \
    CUEME_BIND=0.0.0.0:7878 \
    CUEME_DATA=/config \
    CUEME_LIBRARY=/scripts

EXPOSE 7878

ENTRYPOINT ["/entrypoint.sh"]
