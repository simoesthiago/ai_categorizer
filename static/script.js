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
  uploadBtn: document.getElementById("uploadBtn"),
  uploadInfo: document.getElementById("uploadInfo"),
  previewContainer: document.getElementById("previewContainer"),
  columnLabel: document.getElementById("columnLabel"),
  targetColumn: document.getElementById("targetColumn"),
  addCategoryBtn: document.getElementById("addCategoryBtn"),
  categories: document.getElementById("categories"),
  processBtn: document.getElementById("processBtn"),
  progressBar: document.getElementById("progressBar"),
  progressText: document.getElementById("progressText"),
  logBox: document.getElementById("logBox"),
  resultMeta: document.getElementById("resultMeta"),
  resultPreview: document.getElementById("resultPreview"),
  downloadBtn: document.getElementById("downloadBtn"),
  reprocessBtn: document.getElementById("reprocessBtn"),
};

function logLine(line) {
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

function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function addCategoryRow(name = "", description = "") {
  const row = document.createElement("div");
  row.className = "category-row";
  row.innerHTML = `
    <label>
      Name
      <input class="cat-name" type="text" value="${escapeHtml(name)}" placeholder="Category name">
    </label>
    <label>
      Description
      <input class="cat-description" type="text" value="${escapeHtml(description)}" placeholder="Optional context for the model">
    </label>
    <button class="remove-btn" type="button">Remove</button>
  `;
  row.querySelector(".remove-btn").addEventListener("click", () => {
    row.remove();
  });
  el.categories.appendChild(row);
}

function collectCategories() {
  const rows = [...el.categories.querySelectorAll(".category-row")];
  return rows
    .map((row) => ({
      name: row.querySelector(".cat-name").value.trim(),
      description: row.querySelector(".cat-description").value.trim(),
    }))
    .filter((cat) => cat.name.length > 0);
}

function setProgress(progressPct, text) {
  const pct = Math.max(0, Math.min(100, Number(progressPct) || 0));
  el.progressBar.style.width = `${pct}%`;
  el.progressText.textContent = `${pct}% - ${text}`;
}

async function uploadFile() {
  const file = el.fileInput.files[0];
  if (!file) {
    logLine("Please select a .csv or .xlsx file first.");
    return;
  }

  const data = new FormData();
  data.append("file", file);
  setProgress(0, "Uploading file...");
  logLine(`Uploading ${file.name}...`);

  const response = await fetch("/api/upload", { method: "POST", body: data });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Upload failed.");
  }

  state.fileId = payload.file_id;
  el.uploadInfo.textContent = `Uploaded ${payload.filename} (${payload.rows} rows).`;
  renderTable(el.previewContainer, payload.preview);
  el.previewContainer.classList.remove("hidden");
  el.columnLabel.classList.remove("hidden");
  el.targetColumn.innerHTML = payload.columns
    .map((col) => `<option value="${escapeHtml(col)}">${escapeHtml(col)}</option>`)
    .join("");
  setProgress(0, "File uploaded.");
  logLine("Upload complete.");
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
    model: el.model.value.trim(),
    batch_size: Number(el.batchSize.value),
    delay_seconds: Number(el.delaySeconds.value),
    include_confidence: el.includeConfidence.checked,
  };

  el.resultPreview.innerHTML = "";
  el.resultMeta.textContent = "";
  el.downloadBtn.classList.add("hidden");
  el.reprocessBtn.classList.add("hidden");

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
  };
}

async function loadResult(jobId) {
  const response = await fetch(`/api/result/${jobId}`);
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Could not load result.");
  }

  renderTable(el.resultPreview, data.preview);
  const failed = data.failed_batches || [];
  el.resultMeta.textContent =
    failed.length > 0
      ? `Completed with ${failed.length} failed batches. You can reprocess failed rows.`
      : "Completed successfully with no failed batches.";
  el.downloadBtn.href = `/api/download/${jobId}`;
  el.downloadBtn.classList.remove("hidden");
  if (failed.length > 0) {
    el.reprocessBtn.classList.remove("hidden");
  } else {
    el.reprocessBtn.classList.add("hidden");
  }
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

el.addCategoryBtn.addEventListener("click", () => addCategoryRow());

el.processBtn.addEventListener("click", async () => {
  try {
    await startProcessing();
  } catch (error) {
    logLine(`Processing error: ${error.message}`);
  }
});

el.reprocessBtn.addEventListener("click", async () => {
  try {
    await reprocessFailedRows();
  } catch (error) {
    logLine(`Reprocess error: ${error.message}`);
  }
});

addCategoryRow("Category A", "Example category description");
addCategoryRow("Category B", "Another category description");
