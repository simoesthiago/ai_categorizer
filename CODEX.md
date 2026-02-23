# CODEX.md - Implementation Guide for AI DePara Categorizer

## Objective
Implement AI DePara Categorizer v1.0 as a local Flask web app for semantic batch categorization of `.xlsx` and `.csv` data, based on `docs/AI_DePara_Categorizer_PRD.pdf`.

## Language rule
- All app copy, documentation, labels, logs, and user-facing outputs must be in English.
- Keep code comments and variable naming in English unless a strict external constraint requires otherwise.

## Implementation principles
- Deliver end-to-end value early (upload -> process -> download).
- Prefer simplicity and predictability over unnecessary complexity.
- Failures must be visible, isolated per batch, and recoverable.
- Never allow categories outside the user-defined category list.

## Target project structure
- `app.py`: Flask server and REST/SSE routes.
- `categorizer.py`: AI engine (chunking, prompt, retry, validation).
- `templates/index.html`: main interface.
- `static/style.css`: styles.
- `static/script.js`: frontend flow (upload, categories, progress, download).
- `.env` / `.env.example`: local configuration.
- `requirements.txt`: Python dependencies.
- `tests/`: unit and integration tests.

## Required functional flow (v1.0)
1. Upload `.xlsx`/`.csv`.
2. Preview first rows and choose target column.
3. Create categories (name + optional description).
4. Process in batches with real-time progress.
5. Download file with `AI_Category`.

## AI engine quality rules
- Default batch size: `50` (configurable).
- Retry per batch: `3` attempts with exponential backoff.
- Strict output validation: only registered categories are accepted.
- Controlled fallback: `Not categorized` for invalid responses.
- Structured batch logs (start, end, duration, error).

## Non-functional requirements
- Process 1,000 rows in under 3 minutes in the target profile.
- Local setup in under 10 minutes.
- Responsive UI for desktop and laptop.
- No cloud/deploy dependency to run locally.

## Minimum security requirements
- Never commit `.env`.
- Mask API key in the UI.
- Avoid persisting raw input data to disk unless required for final download.
- Log only technical metadata (do not log raw sensitive data).

## Recommended execution plan
1. Flask skeleton + initial layout + healthcheck.
2. Upload/preview/column selection.
3. Category management with validation.
4. Batch categorization engine + robust parser.
5. SSE progress + error logs + selective reprocessing.
6. Output export + tests + usage docs.

## Internal acceptance checklist
- Upload and download work for `.xlsx` and `.csv`.
- `AI_Category` column is correctly added.
- Category validation rules are enforced for 100% of rows.
- Batch failure does not interrupt full execution.
- Critical tests pass locally.

## Local skills installed for this project
- `skills/pdf`: support for reading/extracting PDF specs.
- `skills/spreadsheet`: support for spreadsheet workflows.
- `skills/security-best-practices`: secrets and data hardening guidance.
- `skills/playwright`: web UI E2E testing.
- `skills/doc`: documentation generation and standardization.

## Practical conventions
- Use self-explanatory function and variable names.
- Add short comments only for non-obvious logic.
- Add tests for each fixed bug in the core engine.
- Keep business logic decoupled from web layer concerns.
