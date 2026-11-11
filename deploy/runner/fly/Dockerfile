# Dedicated VM control plane. Member code runs only in nested gVisor sandboxes.
FROM node:22-bookworm-slim@sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d AS node
FROM docker:29-dind@sha256:08a98015fce594af7c382883bea080ea206de74402a95da9dc52b6428c8cd121 AS docker
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
COPY traceharness-0.3.0-py3-none-any.whl /opt/traceharness-0.3.0-py3-none-any.whl
RUN python -m pip install --no-deps /opt/traceharness-0.3.0-py3-none-any.whl && rm /opt/traceharness-0.3.0-py3-none-any.whl
ENV PYTHONDONTWRITEBYTECODE=1
LABEL org.traceharness.runtime="${RUNTIME_ID}" org.traceharness.version="${RUNTIME_VERSION}"
USER 10001:10001
WORKDIR /workspace
ENTRYPOINT ["python", "-m", "traceharness.runner_service.container_entrypoint"]

FROM dependencies AS grader
COPY grader/ /opt/traceharness-grader/
RUN printf '#!/bin/sh\nexec python -I /opt/traceharness-grader/grade.py\n' > /opt/traceharness-grade && chmod 755 /opt/traceharness-grade
ENTRYPOINT ["/opt/traceharness-grade"]

FROM dependencies AS control
COPY --from=docker /usr/local/bin/docker /usr/local/bin/dockerd /usr/local/bin/docker-init /usr/local/bin/docker-proxy /usr/local/bin/containerd-shim-runc-v2 /usr/local/bin/ctr /usr/local/bin/runc /usr/local/bin/
COPY gvisor-x86_64.tar.bz2 /tmp/gvisor.tar.bz2
RUN echo '6f6b1a8f0f4665a403238135167d0d990bfaeaff5544abf68f5e0d822b35484a  /tmp/gvisor.tar.bz2' | sha256sum -c - \
    && tar -xjf /tmp/gvisor.tar.bz2 -C /usr/local/bin && rm /tmp/gvisor.tar.bz2
COPY traceharness/ /opt/traceharness/traceharness/
COPY images.tar.gz /opt/traceharness-images.tar.gz
COPY inventory/ /opt/traceharness-inventory/
COPY start.py /opt/start.py
COPY verify_runtime.py /opt/verify_runtime.py
ENV PYTHONPATH=/opt/traceharness PYTHONDONTWRITEBYTECODE=1 RUNNER_STATE_DIR=/data/jobs RUNNER_REGISTRY=/data/inventory/registry.json RUNNER_EXECUTION_ENABLED=0 RUNNER_DOCKER=/usr/local/bin/docker
ENTRYPOINT ["python", "/opt/start.py"]
