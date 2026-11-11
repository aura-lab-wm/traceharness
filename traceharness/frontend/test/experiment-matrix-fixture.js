// Wire fixtures for the actual frozen-plan protocol; no provider execution.
export function frozenMatrixPlan(plan, suppliedTrials = null) {
  const arms = plan.arms.map((arm, index) => {
    const trial = suppliedTrials?.find(row => row.arm_id === arm.id)
    return { ...arm, manifest_sha256: trial?.manifest_sha256 || String(index + 1).repeat(64).slice(0, 64),
      manifest: { ...arm.configuration, runtime_version: 'fixture', task_revision: 'fixture-revision', ...trial?.job?.manifest } }
  })
  const schedule = []
  for (let repeat = 1; repeat <= plan.repeats; repeat++) for (const arm of arms) {
    const index = schedule.length
    schedule.push({ id: (index + 1).toString(16).padStart(48, '0'), index, repeat, arm_id: arm.id, manifest_sha256: arm.manifest_sha256 })
  }
  return { ...plan, reference_arm_id: arms[0].id, arms, schedule }
}
export function frozenMatrixTrials(plan, suppliedTrials = null) {
  return plan.schedule.map((row, index) => {
    const supplied = suppliedTrials?.[index]
    const job = supplied?.job ? { ...supplied.job } : null
    if (job) delete job.manifest
    return { status: 'pending', issues: [], ...supplied, ...row, job_id: job?.id || null, job }
  })
}
