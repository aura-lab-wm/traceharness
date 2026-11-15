# The image every third-party agent runs in (traceharness/agents). Built once with
# `traceharness agents build`; at run time its containers have no network (the model is
# reached through a Unix socket served by a separate broker container), no capabilities,
# no new privileges, a read-only root and a non-root user.
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 python3-venv python-is-python3 git ca-certificates ripgrep procps \
    && rm -rf /var/lib/apt/lists/*
ARG MINI_SWE_AGENT=2.4.6
ARG CODEX=0.167.1
ARG CLAUDE_CODE=2.1.322
RUN python3 -m venv /opt/mini && /opt/mini/bin/pip install --no-cache-dir "mini-swe-agent==${MINI_SWE_AGENT}"
RUN npm install -g --omit=dev "@openai/codex@${CODEX}" "@anthropic-ai/claude-code@${CLAUDE_CODE}" && npm cache clean --force
RUN useradd -m -u 10001 -U agent && mkdir -p /sock /workspace /output && chown agent:agent /sock /workspace /output
LABEL org.traceharness.mini-swe-agent=${MINI_SWE_AGENT} org.traceharness.codex=${CODEX} org.traceharness.claude-code=${CLAUDE_CODE}
COPY broker.py inside.py grade.py /opt/agents/
USER agent
WORKDIR /workspace
