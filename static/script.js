const state = {
  fileId: null,
  jobId: null,
  eventSource: null,
};

const el = {
  apiKey: document.getElementById("apiKey"),
  model: document.getElementById("model"),
  batchSize: document.getElementById("batchSize"),
  delaySeconds: document.getElementById("delaySeconds"),
  includeConfidence: document.getElementById("includeConfidence"),
  fileInput: document.getElementById("fileInput"),
  uploadZone: document.getElementById("uploadZone"),
  uploadBtn: document.getElementById("uploadBtn"),
  clearFileBtn: document.getElementById("clearFileBtn"),
  uploadInfo: document.getElementById("uploadInfo"),
  skipRows: document.getElementById("skipRows"),
  sheetLabel: document.getElementById("sheetLabel"),
  sheetSelect: document.getElementById("sheetSelect"),
  sheetConfirmRow: document.getElementById("sheetConfirmRow"),
  sheetConfirmBtn: document.getElementById("sheetConfirmBtn"),
  sheetInfo: document.getElementById("sheetInfo"),
  previewContainer: document.getElementById("previewContainer"),
  columnLabel: document.getElementById("columnLabel"),
  targetColumn: document.getElementById("targetColumn"),
  importCsvBtn: document.getElementById("importCsvBtn"),
  categoryFileInput: document.getElementById("categoryFileInput"),
  categories: document.getElementById("categories"),
  dryRun: document.getElementById("dryRun"),
  sampleSize: document.getElementById("sampleSize"),
  processBtn: document.getElementById("processBtn"),
  progressBar: document.getElementById("progressBar"),
  progressText: document.getElementById("progressText"),
  logBox: document.getElementById("logBox"),
  resultMeta: document.getElementById("resultMeta"),
  outputPlaceholder: document.getElementById("outputPlaceholder"),
  failedRowsDetail: document.getElementById("failedRowsDetail"),
  resultPreview: document.getElementById("resultPreview"),
  downloadBtn: document.getElementById("downloadBtn"),
  reprocessBtn: document.getElementById("reprocessBtn"),
};

// Restore API key from session
el.apiKey.value = sessionStorage.getItem("apiKey") || "";
el.apiKey.addEventListener("input", () => sessionStorage.setItem("apiKey", el.apiKey.value));

function logLine(line) {
  el.logBox.classList.remove("hidden");
  const stamp = new Date().toLocaleTimeString();
  el.logBox.textContent += `[${stamp}] ${line}\n`;
  el.logBox.scrollTop = el.logBox.scrollHeight;
}

function renderTable(container, rows) {
  if (!rows || rows.length === 0) {
    container.innerHTML = "<p class='muted'>No rows to display.</p>";
    return;
  }
  const columns = Object.keys(rows[0]);
  const header = columns.map((col) => `<th>${escapeHtml(col)}</th>`).join("");
  const body = rows
    .map((row) => {
      const cells = columns.map((col) => `<td>${escapeHtml(String(row[col] ?? ""))}</td>`).join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");
  container.innerHTML = `<table><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table>`;
}

function renderFailedRowsDetail(container, failedBatches) {
  const rows = failedBatches.flatMap((batch) =>
    (batch.row_indices || []).map((idx, i) => ({
      row: idx + 1,
      value: (batch.rows_content || [])[i] ?? "",
      error: batch.error || "",
    }))
  );
  if (rows.length === 0) {
    container.innerHTML = "";
    return;
  }
  const header = `<tr><th>Row #</th><th>Value</th><th>Error</th></tr>`;
  const body = rows
    .map((r) => `<tr><td>${r.row}</td><td>${escapeHtml(r.value)}</td><td>${escapeHtml(r.error)}</td></tr>`)
    .join("");
  container.innerHTML = `<p style="margin:10px 0 4px;font-weight:600;color:var(--danger)">Failed rows (${rows.length})</p><table><thead>${header}</thead><tbody>${body}</tbody></table>`;
}

function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function collectCategories() {
  const seen = new Set();
  return el.categories.value
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return null;
      const pipe = trimmed.indexOf("|");
      const name = (pipe !== -1 ? trimmed.slice(0, pipe) : trimmed).trim();
      const description = pipe !== -1 ? trimmed.slice(pipe + 1).trim() : "";
      if (!name || seen.has(name.toLowerCase())) return null;
      seen.add(name.toLowerCase());
      return { name, description };
    })
    .filter(Boolean);
}

function loadCategoriesFromCsv(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const lines = e.target.result.split(/\r?\n/);
    const rows = lines
      .map((line) => {
        const parts = line.split(",").map((p) => p.trim().replace(/^["']|["']$/g, ""));
        const name = parts[0] || "";
        const description = parts[1] || "";
        if (!name) return null;
        return description ? `${name} | ${description}` : name;
      })
      .filter(Boolean);
    el.categories.value = rows.join("\n");
    logLine(`Loaded ${rows.length} categories from ${file.name}.`);
  };
  reader.readAsText(file);
  el.categoryFileInput.value = "";
}

function resetProcessBtn() {
  el.processBtn.disabled = false;
  el.processBtn.textContent = "Start Processing";
}

function setProgress(progressPct, text) {
  const pct = Math.max(0, Math.min(100, Number(progressPct) || 0));
  el.progressBar.style.width = `${pct}%`;
  el.progressText.textContent = `${pct}% - ${text}`;
}

function clearFile() {
  el.fileInput.value = "";
  el.uploadZone.classList.remove("has-file");
  el.uploadZone.querySelector(".upload-zone-label").innerHTML =
    'Drop <strong>.csv</strong> or <strong>.xlsx</strong> here, or <span class="upload-link">browse files</span>';
  el.clearFileBtn.classList.add("hidden");
  el.uploadInfo.textContent = "";
  state.fileId = null;
  el.targetColumn.innerHTML = '<option value="">— upload a file first —</option>';
  el.targetColumn.disabled = true;
  el.previewContainer.classList.add("hidden");
  el.previewContainer.innerHTML = "";
  el.sheetLabel.classList.add("hidden");
  el.sheetConfirmRow.classList.add("hidden");
  el.sheetSelect.innerHTML = "";
  el.sheetInfo.textContent = "";
}

function _applyFilePayload(payload) {
  if (payload.filename) {
    el.uploadInfo.textContent = `Uploaded ${payload.filename} (${payload.rows} rows).`;
  } else if (payload.sheet_name) {
    el.uploadInfo.textContent = `Sheet "${payload.sheet_name}" loaded (${payload.rows} rows).`;
  }
  renderTable(el.previewContainer, payload.preview);
  el.previewContainer.classList.remove("hidden");
  el.targetColumn.innerHTML = payload.columns
    .map((col) => `<option value="${escapeHtml(col)}">${escapeHtml(col)}</option>`)
    .join("");
  el.targetColumn.disabled = false;
  setProgress(0, "File ready.");
}

async function uploadFile() {
  const file = el.fileInput.files[0];
  if (!file) {
    logLine("Please select a .csv or .xlsx file first.");
    return;
  }

  const data = new FormData();
  data.append("file", file);
  data.append("skip_rows", el.skipRows.value || "0");
  setProgress(0, "Uploading file...");
  logLine(`Uploading ${file.name}...`);

  const response = await fetch("/api/upload", { method: "POST", body: data });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Upload failed.");
  }

  state.fileId = payload.file_id;

  if (payload.needs_sheet_selection) {
    el.uploadInfo.textContent = `Uploaded ${payload.filename} — select a sheet to continue.`;
    el.sheetSelect.innerHTML = payload.sheet_names
      .map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`)
      .join("");
    el.sheetLabel.classList.remove("hidden");
    el.sheetConfirmRow.classList.remove("hidden");
    el.sheetInfo.textContent = "";
    el.previewContainer.classList.add("hidden");
    el.targetColumn.innerHTML = '<option value="">— select a sheet first —</option>';
    el.targetColumn.disabled = true;
    setProgress(0, "Select a sheet to load.");
    logLine(`File has ${payload.sheet_names.length} sheets — pick one and click "Load Sheet".`);
  } else {
    el.sheetLabel.classList.add("hidden");
    el.sheetConfirmRow.classList.add("hidden");
    _applyFilePayload(payload);
    logLine("Upload complete.");
  }
}

async function selectSheet() {
  const sheetName = el.sheetSelect.value;
  if (!sheetName || !state.fileId) return;

  el.sheetConfirmBtn.disabled = true;
  el.sheetConfirmBtn.textContent = "Loading…";
  el.sheetInfo.textContent = "";
  logLine(`Loading sheet "${sheetName}"...`);

  const response = await fetch("/api/select_sheet", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_id: state.fileId, sheet_name: sheetName }),
  });
  const payload = await response.json();

  el.sheetConfirmBtn.disabled = false;
  el.sheetConfirmBtn.textContent = "Load Sheet";

  if (!response.ok) {
    throw new Error(payload.error || "Could not load sheet.");
  }

  _applyFilePayload(payload);
  logLine(`Sheet "${sheetName}" ready.`);
}

async function startProcessing() {
  if (!state.fileId) {
    logLine("Upload a file before starting processing.");
    return;
  }

  const categories = collectCategories();
  if (categories.length < 2) {
    logLine("Add at least two categories.");
    return;
  }

  const payload = {
    file_id: state.fileId,
    target_column: el.targetColumn.value,
    categories,
    api_key: el.apiKey.value.trim(),
    model: el.model.value,
    batch_size: Number(el.batchSize.value),
    delay_seconds: Number(el.delaySeconds.value),
    include_confidence: el.includeConfidence.checked,
    sample_size: el.dryRun.checked ? Number(el.sampleSize.value) : null,
  };

  el.resultPreview.innerHTML = "";
  el.resultMeta.textContent = "";
  el.failedRowsDetail.innerHTML = "";
  el.downloadBtn.classList.add("hidden");
  el.reprocessBtn.classList.add("hidden");
  el.processBtn.disabled = true;
  el.processBtn.textContent = "Processing…";

  logLine("Starting processing...");
  const response = await fetch("/api/process", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Could not start processing.");
  }

  state.jobId = data.job_id;
  setProgress(0, "Job queued.");
  startProgressStream(state.jobId);
}

function startProgressStream(jobId) {
  if (state.eventSource) {
    state.eventSource.close();
  }
  const source = new EventSource(`/api/progress/${jobId}`);
  state.eventSource = source;

  source.onmessage = async (event) => {
    const data = JSON.parse(event.data);
    if (data.error) {
      logLine(data.error);
      source.close();
      return;
    }

    setProgress(data.progress_pct, data.progress_message);
    logLine(
      `${data.status} | batch ${data.processed_batches}/${data.total_batches} | failed batches: ${data.failed_batches_count}`
    );

    if (["completed", "completed_with_errors", "failed"].includes(data.status)) {
      source.close();
      resetProcessBtn();
      if (data.status === "failed") {
        logLine(`Job failed: ${data.error || "unknown error"}`);
        return;
      }
      await loadResult(jobId);
    }
  };

  source.onerror = () => {
    logLine("Progress stream disconnected.");
    source.close();
    resetProcessBtn();
  };
}

async function loadResult(jobId) {
  const response = await fetch(`/api/result/${jobId}`);
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Could not load result.");
  }

  el.outputPlaceholder.classList.add("hidden");
  renderTable(el.resultPreview, data.preview);
  const failed = data.failed_batches || [];
  el.resultMeta.textContent =
    failed.length > 0
      ? `Completed with ${failed.length} failed batch(es). You can reprocess failed rows.`
      : "Completed successfully with no failed batches.";

  if (failed.length > 0) {
    renderFailedRowsDetail(el.failedRowsDetail, failed);
    el.reprocessBtn.classList.remove("hidden");
  } else {
    el.failedRowsDetail.innerHTML = "";
    el.reprocessBtn.classList.add("hidden");
  }

  el.downloadBtn.href = `/api/download/${jobId}`;
  el.downloadBtn.classList.remove("hidden");
  logLine("Result is ready for download.");
}

async function reprocessFailedRows() {
  if (!state.jobId) {
    return;
  }
  logLine("Reprocessing failed rows...");
  const response = await fetch(`/api/reprocess_failed/${state.jobId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: el.apiKey.value.trim() }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Could not reprocess failed rows.");
  }

  startProgressStream(state.jobId);
}

el.uploadBtn.addEventListener("click", async () => {
  try {
    await uploadFile();
  } catch (error) {
    logLine(`Upload error: ${error.message}`);
  }
});

el.importCsvBtn.addEventListener("click", () => el.categoryFileInput.click());

el.categoryFileInput.addEventListener("change", () => {
  const file = el.categoryFileInput.files[0];
  if (file) loadCategoriesFromCsv(file);
});

el.sheetConfirmBtn.addEventListener("click", async () => {
  try {
    await selectSheet();
  } catch (error) {
    logLine(`Sheet load error: ${error.message}`);
    el.sheetConfirmBtn.disabled = false;
    el.sheetConfirmBtn.textContent = "Load Sheet";
  }
});

el.processBtn.addEventListener("click", async () => {
  try {
    await startProcessing();
  } catch (error) {
    logLine(`Processing error: ${error.message}`);
    resetProcessBtn();
  }
});

el.reprocessBtn.addEventListener("click", async () => {
  try {
    await reprocessFailedRows();
  } catch (error) {
    logLine(`Reprocess error: ${error.message}`);
  }
});

el.categories.value = "Category A | Example description for Category A\nCategory B | Example description for Category B";

// Upload zone interactions
el.uploadZone.addEventListener("click", () => el.fileInput.click());

el.fileInput.addEventListener("change", () => {
  const file = el.fileInput.files[0];
  if (file) {
    el.uploadZone.classList.add("has-file");
    el.uploadZone.querySelector(".upload-zone-label").textContent = file.name;
    el.clearFileBtn.classList.remove("hidden");
  }
});

el.uploadZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  el.uploadZone.classList.add("drag-over");
});

el.uploadZone.addEventListener("dragleave", (e) => {
  if (!el.uploadZone.contains(e.relatedTarget)) {
    el.uploadZone.classList.remove("drag-over");
  }
});

el.uploadZone.addEventListener("drop", (e) => {
  e.preventDefault();
  el.uploadZone.classList.remove("drag-over");
  const file = e.dataTransfer.files[0];
  if (file) {
    const dt = new DataTransfer();
    dt.items.add(file);
    el.fileInput.files = dt.files;
    el.uploadZone.classList.add("has-file");
    el.uploadZone.querySelector(".upload-zone-label").textContent = file.name;
    el.clearFileBtn.classList.remove("hidden");
  }
});

el.clearFileBtn.addEventListener("click", (e) => {
  e.stopPropagation(); // prevent triggering upload zone click
  clearFile();
});
