# AGENTS.md

## Project

Inference Lab is a dependency-light educational benchmark for OpenAI-compatible streaming APIs. It records end-to-end latency, TTFT, inter-token latency, token throughput, optional `nvidia-smi` metrics, and browser-side ChatGPT Edu measurements. The UI and documentation are primarily Korean.

## Repository map

- `server.py`: Python HTTP server, SQLite persistence, benchmark execution, GPU sampling, CSV/XLSX export, and PDF-to-Markdown conversion.
- `static/`: framework-free dashboard (`index.html`, `app.js`, and CSS).
- `chatgpt-edu-extension/`: Chrome Manifest V3 extension for browser E2E timing.
- `test_server.py`: `unittest` coverage for metrics, validation, persistence, exports, and PDF input checks.
- `examples/transformer-paper.md`: generated example conversion used by the dashboard.
- `scripts/build_example_workbook.mjs`: source for `outputs/examples/transformer-paper-results.xlsx`; it requires the artifact-tool runtime.
- `benchmark.db`, `.venv/`, `__pycache__/`, and `.artifact-work/`: local/runtime artifacts. Do not treat them as source.

## Setup and commands

Run commands from the repository root on Python 3.10+.

```powershell
uv sync
uv run server.py
uv run python -m unittest -v
uv run python -m py_compile server.py test_server.py
```

The app defaults to `http://127.0.0.1:8080`. Use `--host`/`--port` or `HOST`/`PORT` to override it. Set `BENCHMARK_DB` for an isolated database during manual testing.

For non-local inference endpoints, explicitly set `ALLOWED_TARGET_HOSTS`. Keep the default localhost-only policy unless a task requires otherwise; never broaden it to `*` casually.

There is no JavaScript build step. When Node.js is available, syntax-check changed JavaScript with:

```powershell
node --check static/app.js
node --check chatgpt-edu-extension/background.js
node --check chatgpt-edu-extension/content.js
node --check chatgpt-edu-extension/popup.js
```

## Change guidelines

- Keep the current minimal architecture: Python standard library for the server and plain HTML/CSS/JavaScript for clients. Reuse existing helpers before adding dependencies or abstractions.
- Preserve the shared run shape: `settings`, `samples`, `summary`, and `gpu`. API benchmarks and browser measurements must remain readable by the same dashboard and export paths.
- Never persist or log API keys. Continue excluding `api_key` from saved settings.
- Treat endpoints and uploaded files as trust boundaries. Preserve target-host allowlisting, request-size limits, PDF signature/size validation, and spreadsheet formula-injection protection.
- Keep user-facing copy in Korean unless the surrounding surface uses English. Keep code identifiers in English.
- Use `textContent`/DOM construction for untrusted model or error text. Do not insert model output, prompts, or server errors through `innerHTML`.
- Keep browser-extension permissions and host permissions as narrow as possible. DOM selectors may change with ChatGPT; update all matching and completion-detection paths together.
- Do not hand-edit generated `.xlsx`, database, cache, or preview files. Change their source code/data and regenerate only when the task requires the artifact.
- Avoid unrelated formatting churn. The repository intentionally uses compact code in several frontend files.

## Testing expectations

- Add or update a focused `unittest` for non-trivial Python behavior, especially metrics, persistence, exports, validation, and API error paths.
- Always run `python -m unittest -v` after Python changes.
- Run `py_compile` for changed Python and `node --check` for changed JavaScript.
- For dashboard changes, manually verify page load, benchmark submission, recent-run selection, exports, and PDF conversion as applicable.
- For extension changes, load `chatgpt-edu-extension/` as an unpacked extension and verify Enter/click detection, TTFT, quiet-window completion, backend save, popup results, and disabled state as applicable.
- Tests must not depend on a live model server, an NVIDIA GPU, the real `benchmark.db`, or the public internet. Use temporary databases and mocks/fixtures for external behavior.

## Generated artifacts and commits

- Keep `requirements.txt` pinned when dependencies change.
- Do not commit secrets, local databases, virtual environments, caches, logs, or temporary render output.
- If a source change makes the checked-in examples stale, regenerate and verify the corresponding Markdown/workbook in the same change.
