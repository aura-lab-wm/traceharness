"""The local runner: container, native and experiment jobs on the user's own machine.

The former hosted runner (traceharness.runner_service) runs inside the local console, mounted at
/api/runner/*. This package holds what is local about it: settings and readiness (local.py), the
key handle that resolves to the console's saved OpenRouter key (keyvault.py), the offline scripted
model used for proofs and tests (scripted.py), and `traceharness runner setup|status|verify`
(cli.py, build.py, verify.py). Images are built on the user's machine and never pulled from a registry
we publish. Everything setup needs ships in the wheel under assets/.
"""
