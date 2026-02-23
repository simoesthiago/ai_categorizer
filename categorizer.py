import json
import math
import re
import time
from dataclasses import dataclass
from typing import Callable

import pandas as pd
from openai import OpenAI


@dataclass(frozen=True)
class CategoryDef:
    name: str
    description: str = ""


@dataclass
class CategorizationResult:
    categories: list[str]
    confidences: list[str]
    failed_batches: list[dict]


def run_categorization(
    df: pd.DataFrame,
    target_column: str,
    categories: list[CategoryDef],
    api_key: str,
    model: str = "gpt-4o-mini",
    batch_size: int = 50,
    include_confidence: bool = False,
    max_retries: int = 3,
    delay_seconds: float = 0.0,
    progress_callback: Callable[[dict], None] | None = None,
) -> CategorizationResult:
    if target_column not in df.columns:
        raise ValueError(f"Column '{target_column}' is not in dataframe.")
    if not categories:
        raise ValueError("At least one category is required.")
    if not api_key:
        raise ValueError("OpenAI API key is required.")

    client = OpenAI(api_key=api_key)
    values = df[target_column].fillna("").astype(str).tolist()
    total_rows = len(values)
    if total_rows == 0:
        return CategorizationResult(categories=[], confidences=[], failed_batches=[])

    category_names = [cat.name for cat in categories]
    canonical_map = {name.lower(): name for name in category_names}
    predictions = ["Not categorized"] * total_rows
    confidences = ["Low"] * total_rows if include_confidence else []
    failed_batches: list[dict] = []
    total_batches = math.ceil(total_rows / batch_size)

    for batch_number, start in enumerate(range(0, total_rows, batch_size), start=1):
        end = min(start + batch_size, total_rows)
        items = values[start:end]
        batch_ok = False
        last_error = "Unknown error"

        for attempt in range(1, max_retries + 1):
            try:
                prompt = build_user_prompt(categories, items, include_confidence=include_confidence)
                raw_output = call_model(client=client, model=model, prompt=prompt)
                parsed_categories, parsed_confidences = parse_model_output(
                    raw_output=raw_output,
                    expected_count=len(items),
                    include_confidence=include_confidence,
                )

                normalized_categories = []
                normalized_confidence = []
                for idx, predicted in enumerate(parsed_categories):
                    canonical = canonical_map.get(predicted.strip().lower())
                    if canonical is None:
                        raise ValueError(f"Model returned an invalid category: '{predicted}'")
                    normalized_categories.append(canonical)
                    if include_confidence:
                        confidence = parsed_confidences[idx] if parsed_confidences else "Medium"
                        normalized_confidence.append(normalize_confidence(confidence))

                predictions[start:end] = normalized_categories
                if include_confidence:
                    confidences[start:end] = normalized_confidence
                batch_ok = True
                break
            except Exception as exc:  # noqa: BLE001
                last_error = str(exc)
                if attempt < max_retries:
                    time.sleep(2 ** (attempt - 1))

        if not batch_ok:
            failed_batches.append(
                {
                    "batch_number": batch_number,
                    "row_indices": list(range(start, end)),
                    "error": last_error,
                }
            )

        if progress_callback:
            progress_callback(
                {
                    "processed_batches": batch_number,
                    "total_batches": total_batches,
                    "progress_pct": int((batch_number / total_batches) * 100),
                    "message": f"Processed batch {batch_number}/{total_batches}",
                }
            )

        if delay_seconds > 0 and batch_number < total_batches:
            time.sleep(delay_seconds)

    return CategorizationResult(
        categories=predictions,
        confidences=confidences,
        failed_batches=failed_batches,
    )


def build_user_prompt(categories: list[CategoryDef], items: list[str], include_confidence: bool = False) -> str:
    category_block = []
    for category in categories:
        if category.description:
            category_block.append(f"- {category.name}: {category.description}")
        else:
            category_block.append(f"- {category.name}: No description provided.")

    item_block = [f"{idx + 1}. {item}" for idx, item in enumerate(items)]
    if include_confidence:
        output_instruction = (
            "Return exactly one line per item in this format: <CATEGORY> | <CONFIDENCE>. "
            "CONFIDENCE must be one of High, Medium, Low."
        )
    else:
        output_instruction = (
            "Return exactly one line per item with only the category name. "
            "No numbering, no punctuation, no extra text."
        )

    return (
        "Categories:\n"
        f"{chr(10).join(category_block)}\n\n"
        "Items to categorize:\n"
        f"{chr(10).join(item_block)}\n\n"
        f"{output_instruction}"
    )


def call_model(client: OpenAI, model: str, prompt: str) -> str:
    response = client.chat.completions.create(
        model=model,
        temperature=0,
        messages=[
            {
                "role": "system",
                "content": (
                    "You are a data categorization expert. "
                    "Map each input item to exactly one category from the provided list."
                ),
            },
            {"role": "user", "content": prompt},
        ],
    )
    content = response.choices[0].message.content if response.choices else ""
    if not content:
        raise ValueError("Model returned an empty response.")
    return content.strip()


def parse_model_output(raw_output: str, expected_count: int, include_confidence: bool) -> tuple[list[str], list[str]]:
    text = strip_code_fences(raw_output).strip()
    if not text:
        raise ValueError("Model output is empty after cleanup.")

    parsed_categories: list[str] = []
    parsed_confidence: list[str] = []

    json_ok = False
    if text.startswith("[") or text.startswith("{"):
        try:
            parsed = json.loads(text)
            parsed_categories, parsed_confidence = parse_json_output(parsed, include_confidence)
            json_ok = True
        except json.JSONDecodeError:
            json_ok = False

    if not json_ok:
        parsed_categories, parsed_confidence = parse_line_output(text, include_confidence)

    if len(parsed_categories) != expected_count:
        raise ValueError(
            f"Model output count mismatch. Expected {expected_count}, got {len(parsed_categories)}."
        )
    return parsed_categories, parsed_confidence


def parse_json_output(parsed: object, include_confidence: bool) -> tuple[list[str], list[str]]:
    if isinstance(parsed, dict) and "items" in parsed and isinstance(parsed["items"], list):
        parsed = parsed["items"]
    if not isinstance(parsed, list):
        raise ValueError("JSON output must be a list.")

    categories: list[str] = []
    confidences: list[str] = []

    for entry in parsed:
        if isinstance(entry, str):
            categories.append(clean_category_text(entry))
            if include_confidence:
                confidences.append("Medium")
            continue
        if isinstance(entry, dict):
            category = str(entry.get("category", "")).strip()
            confidence = str(entry.get("confidence", "Medium")).strip()
            categories.append(clean_category_text(category))
            if include_confidence:
                confidences.append(confidence or "Medium")
            continue
        raise ValueError("Invalid JSON entry type.")

    return categories, confidences


def parse_line_output(text: str, include_confidence: bool) -> tuple[list[str], list[str]]:
    categories: list[str] = []
    confidences: list[str] = []
    lines = [line.strip() for line in text.splitlines() if line.strip()]

    for line in lines:
        cleaned = re.sub(r"^\s*\d+[\)\].:\-]\s*", "", line).strip()
        if include_confidence:
            if "|" in cleaned:
                category_part, confidence_part = cleaned.split("|", 1)
                categories.append(clean_category_text(category_part))
                confidences.append(confidence_part.strip() or "Medium")
            else:
                categories.append(clean_category_text(cleaned))
                confidences.append("Medium")
        else:
            categories.append(clean_category_text(cleaned.split("|", 1)[0]))

    return categories, confidences


def clean_category_text(value: str) -> str:
    return value.strip().strip('"').strip("'")


def normalize_confidence(value: str) -> str:
    normalized = value.strip().lower()
    if normalized in {"high", "alta"}:
        return "High"
    if normalized in {"medium", "med", "media"}:
        return "Medium"
    if normalized in {"low", "baixa"}:
        return "Low"
    return "Medium"


def strip_code_fences(text: str) -> str:
    stripped = text.strip()
    if stripped.startswith("```") and stripped.endswith("```"):
        body = "\n".join(stripped.splitlines()[1:-1])
        return body.strip()
    return stripped
