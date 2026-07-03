# Switchboard runtime prompt notes

Markdown notes appended to the agent's system prompt (after the wizard
commandments), resolved by the switchboard per `(harness, model)` pick.

## Layout

```
prompts/
  pi.md                         # harness-level notes (runtime mechanics)
  models/
    openai-gpt-5-family.md      # model-level notes (behavioral steering)
```

- **Harness notes** describe the runtime: tool fences, parallelism, skill flow.
- **Model notes** steer a specific model's habits toward the quality bar
  (evidence: evaluator deductions, YARA blocks, the model's own remarks).

## Adding a note file

1. Create the `.md` file here (one file per harness, or per model / model
   family under `models/`).
2. Import it in `../prompts.ts` and map it in `HARNESS_NOTES` / `MODEL_NOTES`
   (multiple model ids may share one file).

Files are bundled as strings at build time — no runtime filesystem reads.
