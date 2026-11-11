"""Boot only the dedicated runner VM; never install into a shared host daemon."""
import gzip
import ipaddress
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import time

data = Path('/data')
if not data.is_mount():
    raise SystemExit('Runner persistent volume is required.')
data.chmod(0o700)
# Fly mounts combined cgroup-v1 controllers under names such as cpu,cpuacct.
# runsc requires the conventional per-controller aliases to enforce OCI limits.
# Keep the existing hierarchy and quotas; never ignore missing controllers.
cgroups = Path('/sys/fs/cgroup')
for combined in cgroups.iterdir():
    if ',' in combined.name and combined.is_mount():
        for controller in combined.name.split(','):
            alias = cgroups / controller
            if alias.exists() or alias.is_symlink():
                if alias.resolve() != combined.resolve():
                    raise SystemExit('Unexpected cgroup controller alias.')
            else:
                alias.symlink_to(combined.name, target_is_directory=True)
config = {'data-root': '/data/docker', 'iptables': False, 'ip6tables': False,
          'ip-forward': False, 'ip-masq': False, 'bridge': 'none',
          'runtimes': {'runsc': {'path': '/usr/local/bin/runsc',
                                'runtimeArgs': ['--platform=systrap', '--host-uds=open']}}}
Path('/run/traceharness-docker.json').write_text(json.dumps(config))
docker = subprocess.Popen(['dockerd', '--config-file=/run/traceharness-docker.json'], stdout=subprocess.DEVNULL, stderr=sys.stderr)
for _ in range(90):
    if docker.poll() is not None:
        raise SystemExit('Dedicated Docker daemon did not start.')
    if subprocess.run(['docker', 'info'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0:
        break
    time.sleep(1)
else:
    raise SystemExit('Dedicated Docker daemon readiness deadline exceeded.')
inventory = json.loads(Path('/opt/traceharness-inventory/registry.json').read_text())
references = {row['image_digest'] for row in inventory['runtimes']}
references.update(row['grader_image_digest'] for row in inventory['tasks'])
from traceharness.runner_service.execution import pinned_image_matches
def installed(reference):
    result = subprocess.run(['docker', 'image', 'inspect', reference], capture_output=True, timeout=15)
    return result.returncode == 0 and pinned_image_matches(reference, json.loads(result.stdout)[0])
if not all(installed(reference) for reference in references):
    with gzip.open('/opt/traceharness-images.tar.gz', 'rb') as source:
        load = subprocess.Popen(['docker', 'load'], stdin=subprocess.PIPE, stdout=subprocess.DEVNULL)
        shutil.copyfileobj(source, load.stdin)
        load.stdin.close()
        if load.wait() != 0:
            raise SystemExit('Pinned runtime images could not be loaded.')
    if not all(installed(reference) for reference in references):
        raise SystemExit('Loaded runtime image identities did not match inventory.')
if not (data / 'inventory').exists():
    shutil.copytree('/opt/traceharness-inventory', data / 'inventory')
# Bind the VM's actual private IPv4 address, never a wildcard. The public Fly
# proxy terminates HTTPS; every API operation still needs the Worker's HMAC.
addresses = json.loads(subprocess.check_output(['ip', '-j', '-4', 'addr', 'show', 'dev', 'eth0']))
host = next(item['local'] for link in addresses for item in link['addr_info'] if item['scope'] == 'global')
if not ipaddress.ip_address(host).is_private or host == '0.0.0.0':
    raise SystemExit('Expected a private VM address.')
service = subprocess.Popen([sys.executable, '-m', 'uvicorn', 'traceharness.runner_service:create_app', '--factory',
                            '--host', host, '--port', '8743', '--no-access-log', '--limit-concurrency', '32'])
def stop(_signal, _frame):
    service.terminate()
signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)
result = service.wait()
docker.terminate()
try:
    docker.wait(timeout=30)
except subprocess.TimeoutExpired:
    docker.kill()
raise SystemExit(result)
