/** "Isolation: gVisor" or "Isolation: Docker" from a job manifest's isolation_runtime, '' when the
    manifest does not carry one (an older run). */
export function isolationLabel(manifest) {
  const runtime = manifest?.isolation_runtime
  return runtime === 'runsc' ? 'Isolation: gVisor' : runtime === 'runc' ? 'Isolation: Docker' : ''
}
