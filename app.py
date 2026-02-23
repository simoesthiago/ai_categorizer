import io
import json
import math
import os
import threading
import time
import uuid
from datetime import datetime, timezone
from typing import Any

import pandas as pd
from dotenv import load_dotenv
from flask import Flask, Response, jsonify, render_template, request, send_file
from werkzeug.utils import secure_filename

from categorizer import CategoryDef, run_categorization

load_dotenv()

MAX_FILE_MB = 50
ALLOWED_EXTENSIONS = {".csv", ".xlsx"}
TERMINAL_STATUSES = {"completed", "completed_with_errors", "failed"}

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_FILE_MB * 1024 * 1024

STORE_LOCK = threading.Lock()
FILE_STORE: dict[str, dict[str, Any]] = {}
JOB_STORE: dict[str, dict[str, Any]] = {}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def parse_dataframe(file_bytes: bytes, extension: str) -> pd.DataFrame:
    if extension == ".xlsx":
        return pd.read_excel(io.BytesIO(file_bytes))

    for encoding in ("utf-8-sig", "utf-8", "latin-1"):
        try:
            return pd.read_csv(io.BytesIO(file_bytes), encoding=encoding)
        except UnicodeDecodeError:
            continue
    raise ValueError("Could not decode CSV file with utf-8 or latin-1.")


def dataframe_preview(df: pd.DataFrame, limit: int) -> list[dict[str, str]]:
    safe = df.head(limit).copy()
    safe = safe.where(pd.notna(safe), "")
    safe = safe.astype(str)
    return safe.to_dict(orient="records")


def validate_categories(payload_categories: Any) -> list[CategoryDef]:
    if not isinstance(payload_categories, list):
        raise ValueError("Categories must be a list.")

    categories: list[CategoryDef] = []
    seen = set()
    for raw in payload_categories:
        if not isinstance(raw, dict):
            raise ValueError("Each category must be an object.")
        name = str(raw.get("name", "")).strip()
        description = str(raw.get("description", "")).strip()
        if not name:
            continue
        lower_name = name.lower()
        if lower_name in seen:
            raise ValueError(f"Duplicate category: {name}")
        seen.add(lower_name)
        categories.append(CategoryDef(name=name, description=description))

    if len(categories) < 2:
        raise ValueError("Add at least two categories before processing.")
    return categories


def resolve_target_column(df: pd.DataFrame, selected_name: str) -> Any:
    for column in df.columns:
        if str(column) == selected_name:
            return column
    raise ValueError("Selected column does not exist in this file.")


def get_api_key(payload: dict[str, Any]) -> str:
    api_key = str(payload.get("api_key", "")).strip() or os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise ValueError("OpenAI API key is required.")
    return api_key


def job_snapshot(job: dict[str, Any]) -> dict[str, Any]:
    return {
        "job_id": job["job_id"],
        "status": job["status"],
        "progress_pct": job["progress_pct"],
        "progress_message": job["progress_message"],
        "processed_batches": job["processed_batches"],
        "total_batches": job["total_batches"],
        "failed_batches_count": len(job["failed_batches"]),
        "error": job["error"],
        "created_at": job["created_at"],
        "started_at": job["started_at"],
        "completed_at": job["completed_at"],
    }


def update_job(job_id: str, **changes: Any) -> None:
    with STORE_LOCK:
        job = JOB_STORE.get(job_id)
        if not job:
            return
        job.update(changes)


def process_job(job_id: str, api_key: str) -> None:
    with STORE_LOCK:
        job = JOB_STORE[job_id]
        source = FILE_STORE[job["file_id"]]
        source_df = source["dataframe"].copy()
        target_column = job["target_column"]
        categories = list(job["categories"])
        model = job["model"]
        batch_size = job["batch_size"]
        include_confidence = job["include_confidence"]
        delay_seconds = job["delay_seconds"]

    update_job(job_id, status="running", started_at=utc_now(), progress_message="Starting processing...")

    def progress_callback(info: dict[str, Any]) -> None:
        update_job(
            job_id,
            processed_batches=info["processed_batches"],
            total_batches=info["total_batches"],
            progress_pct=info["progress_pct"],
            progress_message=info["message"],
        )

    try:
        result = run_categorization(
            df=source_df,
            target_column=target_column,
            categories=categories,
            api_key=api_key,
            model=model,
            batch_size=batch_size,
            include_confidence=include_confidence,
            delay_seconds=delay_seconds,
            progress_callback=progress_callback,
        )

        output_df = source_df.copy()
        output_df["AI_Category"] = result.categories
        if include_confidence:
            output_df["AI_Confidence"] = result.confidences

        final_status = "completed_with_errors" if result.failed_batches else "completed"
        update_job(
            job_id,
            status=final_status,
            completed_at=utc_now(),
            progress_pct=100,
            progress_message="Processing finished.",
            failed_batches=result.failed_batches,
            result_df=output_df,
            result_preview=dataframe_preview(output_df, 20),
        )
    except Exception as exc:  # noqa: BLE001
        update_job(
            job_id,
            status="failed",
            completed_at=utc_now(),
            progress_message="Processing failed.",
            error=str(exc),
        )


def reprocess_failed_rows(job_id: str, api_key: str, failed_indices: list[int]) -> None:
    with STORE_LOCK:
        job = JOB_STORE[job_id]
        source = FILE_STORE[job["file_id"]]
        source_df = source["dataframe"].copy()
        result_df = job["result_df"].copy()
        target_column = job["target_column"]
        categories = list(job["categories"])
        model = job["model"]
        batch_size = job["batch_size"]
        include_confidence = job["include_confidence"]
        delay_seconds = job["delay_seconds"]

    subset_df = source_df.iloc[failed_indices].reset_index(drop=True)
    update_job(
        job_id,
        status="reprocessing",
        progress_pct=0,
        processed_batches=0,
        total_batches=max(1, math.ceil(len(failed_indices) / batch_size)),
        progress_message=f"Reprocessing {len(failed_indices)} failed rows...",
        error=None,
    )

    def progress_callback(info: dict[str, Any]) -> None:
        update_job(
            job_id,
            processed_batches=info["processed_batches"],
            total_batches=info["total_batches"],
            progress_pct=info["progress_pct"],
            progress_message=f"Reprocessing - {info['message']}",
        )

    try:
        result = run_categorization(
            df=subset_df,
            target_column=target_column,
            categories=categories,
            api_key=api_key,
            model=model,
            batch_size=batch_size,
            include_confidence=include_confidence,
            delay_seconds=delay_seconds,
            progress_callback=progress_callback,
        )

        for subset_idx, original_idx in enumerate(failed_indices):
            result_df.at[original_idx, "AI_Category"] = result.categories[subset_idx]
            if include_confidence:
                result_df.at[original_idx, "AI_Confidence"] = result.confidences[subset_idx]

        remapped_failed = []
        for failed_batch in result.failed_batches:
            remapped = [failed_indices[sub_idx] for sub_idx in failed_batch["row_indices"]]
            remapped_failed.append(
                {
                    "batch_number": failed_batch["batch_number"],
                    "row_indices": remapped,
                    "error": failed_batch["error"],
                }
            )

        final_status = "completed_with_errors" if remapped_failed else "completed"
        update_job(
            job_id,
            status=final_status,
            completed_at=utc_now(),
            progress_pct=100,
            progress_message="Reprocessing finished.",
            failed_batches=remapped_failed,
            result_df=result_df,
            result_preview=dataframe_preview(result_df, 20),
        )
    except Exception as exc:  # noqa: BLE001
        update_job(
            job_id,
            status="failed",
            completed_at=utc_now(),
            progress_message="Reprocessing failed.",
            error=str(exc),
        )


@app.route("/")
def index() -> str:
    return render_template("index.html")


@app.route("/api/upload", methods=["POST"])
def upload_file() -> Response:
    uploaded = request.files.get("file")
    if uploaded is None:
        return jsonify({"error": "File is required."}), 400

    filename = secure_filename(uploaded.filename or "")
    extension = os.path.splitext(filename)[1].lower()
    if extension not in ALLOWED_EXTENSIONS:
        return jsonify({"error": "Only .xlsx and .csv files are supported."}), 400

    file_bytes = uploaded.read()
    if not file_bytes:
        return jsonify({"error": "Uploaded file is empty."}), 400

    try:
        df = parse_dataframe(file_bytes, extension)
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": f"Could not read file: {exc}"}), 400

    if df.empty:
        return jsonify({"error": "File has no data rows."}), 400

    file_id = str(uuid.uuid4())
    with STORE_LOCK:
        FILE_STORE[file_id] = {
            "file_id": file_id,
            "filename": filename,
            "extension": extension,
            "dataframe": df,
            "uploaded_at": utc_now(),
        }

    return jsonify(
        {
            "file_id": file_id,
            "filename": filename,
            "rows": int(len(df)),
            "columns": [str(col) for col in df.columns],
            "preview": dataframe_preview(df, 10),
        }
    )


@app.route("/api/process", methods=["POST"])
def process_file() -> Response:
    payload = request.get_json(silent=True) or {}
    file_id = str(payload.get("file_id", "")).strip()
    target_column = str(payload.get("target_column", "")).strip()

    if not file_id:
        return jsonify({"error": "file_id is required."}), 400
    if not target_column:
        return jsonify({"error": "target_column is required."}), 400

    with STORE_LOCK:
        source = FILE_STORE.get(file_id)
    if not source:
        return jsonify({"error": "Invalid file_id."}), 404

    try:
        categories = validate_categories(payload.get("categories"))
        api_key = get_api_key(payload)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    df = source["dataframe"]
    try:
        resolved_column = resolve_target_column(df, target_column)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    model = str(payload.get("model", "")).strip() or os.getenv("OPENAI_MODEL", "gpt-4o-mini")
    include_confidence = bool(payload.get("include_confidence", False))
    delay_seconds = float(payload.get("delay_seconds", 0.0) or 0.0)
    try:
        batch_size = int(payload.get("batch_size", 50))
    except (TypeError, ValueError):
        return jsonify({"error": "batch_size must be a number."}), 400
    batch_size = max(1, min(batch_size, 500))

    total_rows = int(len(df))
    total_batches = max(1, math.ceil(total_rows / batch_size))
    job_id = str(uuid.uuid4())
    with STORE_LOCK:
        JOB_STORE[job_id] = {
            "job_id": job_id,
            "status": "queued",
            "file_id": file_id,
            "target_column": resolved_column,
            "categories": categories,
            "model": model,
            "batch_size": batch_size,
            "include_confidence": include_confidence,
            "delay_seconds": delay_seconds,
            "created_at": utc_now(),
            "started_at": None,
            "completed_at": None,
            "processed_batches": 0,
            "total_batches": total_batches,
            "progress_pct": 0,
            "progress_message": "Queued",
            "failed_batches": [],
            "error": None,
            "result_df": None,
            "result_preview": [],
        }

    thread = threading.Thread(target=process_job, args=(job_id, api_key), daemon=True)
    thread.start()

    return jsonify({"job_id": job_id})


@app.route("/api/job/<job_id>", methods=["GET"])
def get_job(job_id: str) -> Response:
    with STORE_LOCK:
        job = JOB_STORE.get(job_id)
    if not job:
        return jsonify({"error": "Job not found."}), 404
    return jsonify(job_snapshot(job))


@app.route("/api/progress/<job_id>", methods=["GET"])
def stream_progress(job_id: str) -> Response:
    def event_stream() -> Any:
        while True:
            with STORE_LOCK:
                job = JOB_STORE.get(job_id)
                payload = None if not job else job_snapshot(job)
            if payload is None:
                yield f"data: {json.dumps({'error': 'Job not found.'})}\n\n"
                break

            yield f"data: {json.dumps(payload)}\n\n"
            if payload["status"] in TERMINAL_STATUSES:
                break
            time.sleep(1)

    return Response(event_stream(), mimetype="text/event-stream")


@app.route("/api/result/<job_id>", methods=["GET"])
def get_result(job_id: str) -> Response:
    with STORE_LOCK:
        job = JOB_STORE.get(job_id)
    if not job:
        return jsonify({"error": "Job not found."}), 404
    if job["status"] not in TERMINAL_STATUSES:
        return jsonify({"error": "Job is still running."}), 409
    if job["status"] == "failed":
        return jsonify({"error": job["error"] or "Processing failed."}), 400

    return jsonify(
        {
            "job_id": job_id,
            "status": job["status"],
            "failed_batches": job["failed_batches"],
            "preview": job["result_preview"],
        }
    )


@app.route("/api/reprocess_failed/<job_id>", methods=["POST"])
def reprocess_failed(job_id: str) -> Response:
    with STORE_LOCK:
        job = JOB_STORE.get(job_id)
    if not job:
        return jsonify({"error": "Job not found."}), 404
    if job["status"] not in {"completed", "completed_with_errors"}:
        return jsonify({"error": "Only completed jobs can be reprocessed."}), 409

    failed_rows = sorted({idx for batch in job["failed_batches"] for idx in batch["row_indices"]})
    if not failed_rows:
        return jsonify({"message": "No failed rows to reprocess.", "job_id": job_id})

    payload = request.get_json(silent=True) or {}
    try:
        api_key = get_api_key(payload)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    thread = threading.Thread(target=reprocess_failed_rows, args=(job_id, api_key, failed_rows), daemon=True)
    thread.start()

    return jsonify({"job_id": job_id, "rows_reprocessing": len(failed_rows)})


@app.route("/api/download/<job_id>", methods=["GET"])
def download_result(job_id: str) -> Response:
    with STORE_LOCK:
        job = JOB_STORE.get(job_id)
        if not job:
            return jsonify({"error": "Job not found."}), 404
        if job["status"] not in {"completed", "completed_with_errors"}:
            return jsonify({"error": "Result is not ready yet."}), 409

        source = FILE_STORE[job["file_id"]]
        extension = source["extension"]
        original_name = source["filename"]
        result_df = job["result_df"]

    if result_df is None:
        return jsonify({"error": "Result dataframe is missing."}), 500

    stem = os.path.splitext(original_name)[0]
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_name = f"{stem}_categorized_{timestamp}{extension}"

    buffer = io.BytesIO()
    if extension == ".xlsx":
        result_df.to_excel(buffer, index=False, engine="openpyxl")
        mimetype = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    else:
        csv_data = result_df.to_csv(index=False).encode("utf-8-sig")
        buffer.write(csv_data)
        mimetype = "text/csv"

    buffer.seek(0)
    return send_file(buffer, mimetype=mimetype, as_attachment=True, download_name=output_name)


if __name__ == "__main__":
    port = int(os.getenv("FLASK_PORT", "5000"))
    app.run(host="127.0.0.1", port=port, debug=True)
