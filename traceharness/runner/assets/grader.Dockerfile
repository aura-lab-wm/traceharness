# Trusted offline grader only. Native agent CLIs belong in the runtime images.
FROM python:3.12-slim-bookworm@sha256:935c3c5b12357a7e10caa9c1e6ca5692344d97cf229832ef584be2cec9fc03df
COPY requirements.lock /opt/task-requirements.lock
RUN python -m pip install --no-cache-dir --only-binary=:all: --require-hashes -r /opt/task-requirements.lock
COPY grader/ /opt/traceharness-grader/
RUN printf '#!/bin/sh\nexec python -I /opt/traceharness-grader/grade.py\n' > /opt/traceharness-grade && chmod 755 /opt/traceharness-grade
ENV PYTHONDONTWRITEBYTECODE=1
ENTRYPOINT ["/opt/traceharness-grade"]
