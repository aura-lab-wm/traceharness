# Requests: JSON decoding errors break process pools

Upstream issue: https://github.com/psf/requests/issues/6628
Repository: https://github.com/psf/requests
Baseline revision: 96b22fa18c00831656ee4b286bf1c9062459b00a

A worker that receives an invalid JSON response should return Requests' JSON decoding exception to its caller. At this revision, serializing and deserializing that exception loses constructor arguments. In a process pool this can terminate the pool and interrupt unrelated work.

Repair the source so Requests' JSON decoding exception survives pickle round-trips with its message, document and position intact, including exceptions raised by Response.json(). A failed JSON decode from one process-pool job must not prevent the next job from completing. Preserve Requests' existing exception inheritance and ordinary valid-JSON behavior.

This curated task has an explicit edit policy, also available in `TRACEHARNESS_TASK_POLICY.json`. Change only `src/requests/exceptions.py`, adding one synchronous `JSONDecodeError.__reduce__(self)` method. Preserve the entire existing module, including its constructor and imports. Every other original repository file must remain unchanged. Comments and formatting in the editable module may change. Extra workspace files are excluded from the pristine grading reconstruction.

The new method must take exactly `self`, with no decorators, defaults, annotations, type parameters or additional parameters. Its body may contain a literal docstring followed by one return statement using either `CompatJSONDecodeError.__reduce__(self)`, `(self.__class__, (self.msg, self.doc, self.pos))`, or `(type(self), (self.msg, self.doc, self.pos))`. Use UTF-8 source. The grader enforces this task-specific policy before importing any candidate code, then checks actual behavior. Other curated tasks can define different edit policies; harness and model configuration remain independent.

Preserve the existing formatted exception text and `args`, including JSON location information, and the constructor's request/response keyword behavior. The repository and public reproduction are available locally. Run the public check with:

    PYTHONPATH=src python -m unittest discover -s public_tests -v

The public tests reproduce the reported failure without an external HTTP service. Independent offline checks run after execution. Do not install dependencies or use network access; the task environment already provides the required dependencies.

This is a TraceHarness task derived from a real upstream issue. It is not presented as a SWE-bench benchmark result.
