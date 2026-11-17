# The three runtime images of the local runner (target: runtime), built on the user's own machine by
# `traceharness runner setup`. Nothing here is pulled from a registry we publish: the bases are
# digest-pinned public images, the agent CLIs come from their own npm packages at pinned versions, and
# the traceharness package is the one installed on this machine (copied from package/, with its own
# dist-info, so the engine inside the job reports the same version as the console that built it).
#
#   docker build --target runtime -t traceharness-<id>-local \
#     --build-arg RUNTIME_ID=<id> --build-arg RUNTIME_VERSION=<version> --build-arg PACKAGE_VERSION=<pkg> .
FROM node:22-bookworm-slim@sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d AS node
FROM python:3.12-slim-bookworm@sha256:935c3c5b12357a7e10caa9c1e6ca5692344d97cf229832ef584be2cec9fc03df AS dependencies
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
    && apt-get update && apt-get install -y --no-install-recommends git ca-certificates ripgrep procps iproute2 bzip2 \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global @anthropic-ai/claude-code@2.1.322 @openai/codex@0.167.1 \
    && python -m pip install --no-cache-dir fastapi==0.138.1 uvicorn==0.49.0 httpx==0.28.1
COPY requirements.lock /opt/task-requirements.lock
RUN python -m pip install --no-cache-dir --only-binary=:all: --require-hashes -r /opt/task-requirements.lock

FROM dependencies AS runtime
ARG RUNTIME_ID
ARG RUNTIME_VERSION
ARG PACKAGE_VERSION
COPY package/traceharness /usr/local/lib/python3.12/site-packages/traceharness
RUN SP=/usr/local/lib/python3.12/site-packages \
    && mkdir "$SP/traceharness-$PACKAGE_VERSION.dist-info" \
    && printf 'Metadata-Version: 2.1\nName: traceharness\nVersion: %s\n' "$PACKAGE_VERSION" > "$SP/traceharness-$PACKAGE_VERSION.dist-info/METADATA" \
    && printf 'pip\n' > "$SP/traceharness-$PACKAGE_VERSION.dist-info/INSTALLER" \
    && python -c "import importlib.metadata as m; assert m.version('traceharness') == '$PACKAGE_VERSION'"
ENV PYTHONDONTWRITEBYTECODE=1
LABEL org.traceharness.runtime="${RUNTIME_ID}" org.traceharness.version="${RUNTIME_VERSION}"
USER 10001:10001
WORKDIR /workspace
ENTRYPOINT ["python", "-m", "traceharness.runner_service.container_entrypoint"]
