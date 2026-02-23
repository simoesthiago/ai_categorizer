# AI DePara Categorizer

Local Flask application for semantic spreadsheet categorization using OpenAI models.

## Features
- Upload `.csv` and `.xlsx` files (up to 50 MB).
- Preview uploaded rows and select target column.
- Define dynamic category list with optional descriptions.
- Batch processing with retry and exponential backoff.
- Real-time progress updates via SSE.
- Failed-batch tracking and selective reprocessing.
- Download output with `AI_Category` and optional `AI_Confidence`.

## Quick Start
1. Create and activate a virtual environment.
2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
3. Copy `.env.example` to `.env` and set your key:
   ```bash
   OPENAI_API_KEY=your_key_here
   ```
4. Run the app:
   ```bash
   python app.py
   ```
5. Open `http://127.0.0.1:5000`.

## Notes
- You can also provide API key directly in the UI per run.
- If a model response is invalid after retries, rows are marked as `Not categorized`.
- Output format follows the input type (`.csv` or `.xlsx`).
