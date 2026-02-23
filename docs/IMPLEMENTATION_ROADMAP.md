# Implementation Roadmap - AI DePara Categorizer

## 1) v1.0 Scope (PRD)
- Local web app (`Flask` + `HTML/CSS/JS`) to semantically categorize spreadsheet items using OpenAI API.
- Input: `.xlsx` and `.csv` files.
- Output: original file plus `AI_Category` column (and optionally `AI_Confidence`).
- Batch processing with retry, error logs, and real-time progress.

## 2) Version success goals
- Categorization accuracy on validated sample: `> 85%`.
- 1,000 rows processed in `< 3 min` with `gpt-4o-mini` and default batch `50`.
- API error rate `< 2%` with automatic retry.
- Setup time for new user `< 10 min`.

## 3) Target architecture
- `app.py`: Flask routes, upload/download, progress API (SSE), orchestration.
- `categorizer.py`: chunking, prompt construction, OpenAI calls, validation and retry/backoff.
- `templates/index.html`: main UI.
- `static/style.css` and `static/script.js`: frontend behavior.
- `.env` + `python-dotenv`: local configuration.
- `pandas` + `openpyxl`: data read/write.

## 4) Phase plan

## Phase 0 - Project bootstrap (Day 1)
- Create base folder/file structure.
- Configure `requirements.txt`, `.env.example`, `README.md`.
- Add environment validation (API key and model).
- Deliverable: Flask app runs on `localhost:5000` with initial page.

## Phase 1 - Upload and data preparation (Day 2)
- Implement `.xlsx`/`.csv` upload with size and format validation.
- Preview first 10 rows.
- Target-column selector dropdown.
- Deliverable: user uploads file and confirms target column.

## Phase 2 - Category setup (Day 3)
- UI to add/remove categories dynamically.
- Fields per category: `name` (required) and `description` (optional).
- Validation rule: minimum of 2 categories.
- Deliverable: complete category payload ready for processing.

## Phase 3 - Categorization engine (Days 4 and 5)
- Implement configurable chunking (default `50`).
- Prompt builder with strict output instructions.
- OpenAI batch calls with retry (3 attempts) and backoff.
- Post-response validation to ensure only valid categories.
- Fallback to `Not categorized` for invalid outputs.
- Deliverable: end-to-end processing with row-level results.

## Phase 4 - Progress, resilience, and reprocessing (Day 6)
- Real-time progress bar via SSE.
- Error logs per batch and failed-batch listing.
- Action to reprocess only failed batches.
- Deliverable: observable and recoverable execution without full restart.

## Phase 5 - Output generation and final UX (Day 7)
- Add `AI_Category` column to original dataset.
- Optional: add `AI_Confidence` (`High`, `Medium`, `Low`).
- Preview first 20 rows before download.
- Download in same input format (`.xlsx`/`.csv`).
- Deliverable: final file usable without manual post-processing.

## Phase 6 - Quality and acceptance criteria (Days 8 and 9)
- Unit tests for core engine (`chunking`, parser, validation, retry).
- Integration tests for critical endpoints.
- Performance test with 1,000-row dataset.
- Acceptance checklist from PRD.
- Deliverable: internal-ready `v1.0` release.

## 5) Recommended technical backlog for v1.1
- Structured output with JSON Schema to reduce ambiguity.
- Human-review queue for low-confidence cases.
- Cost/token estimate before processing.
- Privacy mode (sensitive-data masking).
- Execution history persistence.

## 6) Risks and mitigations
- API rate limits: retry with exponential backoff and delay between batches.
- Category outside list: strict validation + controlled fallback.
- Unexpected cost: pre-run estimator by volume and model.
- Low precision with vague categories: guide users to improve category descriptions.

## 7) Definition of done (DoD) for v1.0
- Upload and download for `.xlsx`/`.csv` work up to 50 MB files.
- Column selection and category setup work without UI errors.
- 1,000-row processing stays under 3 minutes in target scenario.
- `AI_Category` is filled only with user-defined categories.
- Partial failures do not stop global execution.
- Local run guide validated on a clean machine.
