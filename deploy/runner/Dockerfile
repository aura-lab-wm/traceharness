# A runtime wrapper, not the existing school/demo image and not a deployment.
# Supply an audited digest-pinned base containing Python and (for native modes)
# the exact Claude Code or Codex binary. No latest-tag/install fallback exists.
ARG RUNTIME_BASE
FROM ${RUNTIME_BASE}
ARG RUNTIME_BASE
ARG RUNTIME_ID
ARG RUNTIME_VERSION
USER 0
COPY wheelhouse/ /opt/runner-wheelhouse/
RUN python -c 'import os,re; assert re.fullmatch(r".+@sha256:[a-f0-9]{64}", os.environ["RUNTIME_BASE"])' \
    && cd /opt/runner-wheelhouse \
    && sha256sum -c SHA256SUMS \
    && python -m pip install --no-index --find-links=. harnesslab==0.3.0
LABEL org.traceharness.runtime="${RUNTIME_ID}" \
      org.traceharness.version="${RUNTIME_VERSION}"
ENV PYTHONDONTWRITEBYTECODE=1
USER 10001:10001
WORKDIR /workspace
ENTRYPOINT ["python", "-m", "harnesslab.runner_service.container_entrypoint"]
