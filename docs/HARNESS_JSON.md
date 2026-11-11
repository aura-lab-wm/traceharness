# Review the whole harness

A harness is a settings file plus the runtime loop that executes it. The JSON view exposes the complete available configuration, including prompts, tools, permissions, context, sampling, stopping conditions and custom fields. Native runtime internals that were not recorded remain unknown.

In the signed-in workbench at `/app`, look for **Full harness JSON**:

- **Harnesses:** inspect the entire current configuration file for any stock shell, custom stack or saved harness. It includes the selected runtime, model, task, limits and native prompt intervention profile when enabled. Editing updates the JSON; inspecting, copying and downloading do not save or execute anything.
- **Native agents:** use **View JSON → Native baseline inventory** to inspect all supplied prompt blocks and their exact recorded metadata. Use **Configuration file** to review Keep/Disable/Replace interventions and their inventory pins. The inventory describes the baseline; the intervention profile describes the changes. It does not imply that every component is patchable or that unrecorded internal settings are known.
- **Recorded runs and task attempts:** inspect the configuration stored in that run's start event. It is never replaced with the current preset, the current editor draft or defaults for missing fields.
- **Analysis → Family matrix:** inspect a harness column, select a recorded snapshot when more than one contributes, and open its full JSON. Snapshot coverage and provenance remain visible. Imported and captured settings may be partial reconstructions.
- **Recent runs:** open a hosted result to inspect its entire returned run manifest, independently of the editor draft. The manifest includes the compiled harness, runtime pins, model/task identity, limits and native interventions when recorded. Use the existing manifest artifact download for its SHA-256-verified original file.

The earlier fixed-card, minimal-wizard and flexible-block views also expose their complete supplied JSON. In the fixed-card view the document is a preset definition; in the wizard and flexible view the block definition and compiled harness are separate documents.

**Copy JSON** and **Download JSON** operate on the selected document. Long prompts and nested fields are not truncated. Wrap lines can be disabled, and the viewer remains keyboard-selectable. Known credential fields and credential-shaped strings are redacted in the view and its copy/download, with an explicit notice; other fields are preserved. Missing recordings show an unavailable state rather than an invented file.

These are inspection and export controls. They do not launch a model, change a historical run, grant tools or permissions, or make a saved configuration executable on an incompatible runtime. A new experiment still needs the normal runner review and admission checks.
