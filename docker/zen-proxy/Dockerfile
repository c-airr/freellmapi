# zen-proxy (github.com/12errh/zen-proxy, MIT): exposes OpenCode's free models
# (deepseek-v4.1-flash-free, glm-5.3-flash-free, ...) as an OpenAI-compatible
# /v1. FreeLLMAPI registers it as a custom endpoint when OPENCODE_PROXY_URL is
# set; see FORK.md ("Darmowe modele OpenCode").
#
# Pinned to a reviewed commit. To update: pick a newer commit from the repo,
# read the diff, then bump ZEN_PROXY_REF and rebuild
# (docker compose --profile opencode build zen-proxy).
FROM node:22-alpine

ARG ZEN_PROXY_REF=8f1ab92803f8a907c99658391d229f6fa550f6d0

WORKDIR /app
RUN wget -qO- "https://github.com/12errh/zen-proxy/archive/${ZEN_PROXY_REF}.tar.gz" \
      | tar xz --strip-components=1 \
 && rm -rf test .github bin claude install.sh install.ps1 \
 && chown -R node:node /app

USER node
# Listen on the compose network; the port is not published to the host.
# Config lives in /tmp so every start uses the env below (no stale state).
ENV HOST=0.0.0.0 \
    PORT=8787 \
    ZEN_PROXY_CONFIG=/tmp/zen-proxy.json
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8787/health >/dev/null || exit 1
CMD ["node", "zen-proxy.mjs"]
