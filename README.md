# AI Categorizer

Add in any spreadsheet a clean, consistent category column in a few clicks.

This project is a local web app. You upload a `.csv` or `.xlsx`, define your categories, run processing, and download the categorized file.

## What This Is For

If you work with messy business data (products, expenses, vendors, services, comments, etc.), this tool helps you standardize records faster.

## Why It Helps

- Works with your own category list (not a generic taxonomy).
- Processes large files in batches with visible progress.
- Keeps going even if one batch fails.
- Lets you retry only failed rows instead of restarting everything.
- Adds `AI_Category` (and optionally `AI_Confidence`) to your output.

## Before You Start

You need:
- Python installed on your machine.
- An OpenAI API key.
- Your spreadsheet (`.csv` or `.xlsx`, up to 50 MB).

Important:
- The app runs locally on your computer.
- Data that needs categorization is sent to the OpenAI API during processing.

## First-Time Setup (PowerShell)

From the project folder:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
```

Then open `.env` and set:

```env
OPENAI_API_KEY=your_key_here
```

You can also paste the API key directly in the app UI for each run.

## Run The App

```powershell
.\.venv\Scripts\Activate.ps1
python app.py
```

Open:

`http://127.0.0.1:5000`

## How To Use (Non-Technical Walkthrough)

1. **API Settings**  
   Enter your API key (or leave empty if it is already in `.env`). Keep default model unless you have a specific reason to change it.
2. **Upload File**  
   Upload your `.csv` or `.xlsx`. The app shows a preview and your column list.
3. **Choose Target Column**  
   Select the column that contains the text you want to classify.
4. **Define Categories**  
   Add at least 2 categories. Use short, clear names. Add a description for each category
5. **Start Processing**  
   Click **Start Processing** and follow progress in real time.
6. **Review Output**  
   Check previewed results, then click **Download Result**.
7. **If There Are Failures**  
   Click **Reprocess Failed Rows** to retry only rows that failed.

## Tips For Better Results

- Use categories that are clearly distinct.
- Avoid overlapping labels like `Other` and `Misc` unless really necessary.
- Add descriptions with business context when category names are ambiguous.
- Start with a small sample first, validate quality, then run the full file.

## Output You Get

- Original columns are preserved.
- New column: `AI_Category`.
- Optional new column: `AI_Confidence`.
- File format stays the same as input (`.csv` in, `.csv` out; `.xlsx` in, `.xlsx` out).

## Troubleshooting

- **"OpenAI API key is required."**  
  Add your key in `.env` or in the API Key field in the UI.
- **"Only .xlsx and .csv files are supported."**  
  Convert your file before upload.
- **File uploads but categorization quality is weak**  
  Improve category definitions and descriptions, then re-run.
- **Some rows became `Not categorized`**  
  The model response for those rows failed validation after retries. Use **Reprocess Failed Rows**.
