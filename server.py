from __future__ import annotations

import argparse
import json
import os
import platform
import sqlite3
import statistics
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import closing
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent
STATIC = ROOT / "static"
DB_PATH = Path(os.environ.get("BENCHMARK_DB", ROOT / "benchmark.db"))
DB_LOCK = threading.Lock()


def now_ms() -> float:
    return time.perf_counter_ns() / 1_000_000


def init_db() -> None:
    with closing(sqlite3.connect(DB_PATH)) as db:
        db.execute(
            """CREATE TABLE IF NOT EXISTS runs (
                id TEXT PRIMARY KEY, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                source TEXT NOT NULL, model TEXT, endpoint TEXT,
                settings_json TEXT NOT NULL, summary_json TEXT NOT NULL,
                samples_json TEXT NOT NULL, gpu_json TEXT NOT NULL
            )"""
        )
        db.commit()


def save_run(run: dict[str, Any]) -> None:
    with DB_LOCK, closing(sqlite3.connect(DB_PATH)) as db:
        db.execute(
            "INSERT INTO runs(id, source, model, endpoint, settings_json, summary_json, samples_json, gpu_json) VALUES(?,?,?,?,?,?,?,?)",
            (
                run["id"], run["source"], run.get("model"), run.get("endpoint"),
                json.dumps(run.get("settings", {}), ensure_ascii=False),
                json.dumps(run.get("summary", {}), ensure_ascii=False),
                json.dumps(run.get("samples", []), ensure_ascii=False),
                json.dumps(run.get("gpu", []), ensure_ascii=False),
            ),
        )
        db.commit()


def list_runs(limit: int = 50) -> list[dict[str, Any]]:
    with closing(sqlite3.connect(DB_PATH)) as db:
        rows = db.execute(
            "SELECT id, created_at, source, model, endpoint, settings_json, summary_json, samples_json, gpu_json FROM runs ORDER BY created_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
    keys = ["id", "created_at", "source", "model", "endpoint", "settings", "summary", "samples", "gpu"]
    output = []
    for row in rows:
        item = dict(zip(keys, row))
        for key in ("settings", "summary", "samples", "gpu"):
            item[key] = json.loads(item[key])
        output.append(item)
    return output


def percentile(values: list[float], p: float) -> float | None:
    if not values:
        return None
    data = sorted(values)
    position = (len(data) - 1) * p
    lo, hi = int(position), min(int(position) + 1, len(data) - 1)
    return round(data[lo] + (data[hi] - data[lo]) * (position - lo), 2)


def summarize(samples: list[dict[str, Any]]) -> dict[str, Any]:
    good = [s for s in samples if not s.get("error")]
    ttft = [float(s["ttft_ms"]) for s in good if s.get("ttft_ms") is not None]
    total = [float(s["total_ms"]) for s in good if s.get("total_ms") is not None]
    tps = [float(s["output_tokens_per_sec"]) for s in good if s.get("output_tokens_per_sec") is not None]
    inter_chunk = [float(v) for s in good for v in s.get("inter_chunk_ms", [])]
    prompt_tokens = [int(s["prompt_tokens"]) for s in good if s.get("prompt_tokens") is not None]
    output_tokens = [int(s["output_tokens"]) for s in good if s.get("output_tokens") is not None]
    return {
        "requests": len(samples), "successes": len(good), "errors": len(samples) - len(good),
        "ttft_mean_ms": round(statistics.fmean(ttft), 2) if ttft else None,
        "ttft_p50_ms": percentile(ttft, .50), "ttft_p95_ms": percentile(ttft, .95),
        "total_mean_ms": round(statistics.fmean(total), 2) if total else None,
        "total_p50_ms": percentile(total, .50), "total_p95_ms": percentile(total, .95),
        "output_tps_mean": round(statistics.fmean(tps), 2) if tps else None,
        "itl_mean_ms": round(statistics.fmean(inter_chunk), 2) if inter_chunk else None,
        "itl_p50_ms": percentile(inter_chunk, .50), "itl_p95_ms": percentile(inter_chunk, .95),
        "itl_p99_ms": percentile(inter_chunk, .99), "itl_max_ms": round(max(inter_chunk), 2) if inter_chunk else None,
        "prompt_tokens_mean": round(statistics.fmean(prompt_tokens), 2) if prompt_tokens else None,
        "output_tokens_mean": round(statistics.fmean(output_tokens), 2) if output_tokens else None,
    }


def summarize_gpu(samples: list[dict[str, Any]]) -> dict[str, Any]:
    readings = [gpu for sample in samples for gpu in sample.get("gpus", [])]
    if not readings:
        return {"available": False}
    util = [float(x["gpu_util_pct"]) for x in readings]
    memory = [float(x["memory_used_mb"]) for x in readings]
    power = [float(x["power_w"]) for x in readings]
    temperature = [float(x["temperature_c"]) for x in readings]
    energy_wh = 0.0
    for previous, current in zip(samples, samples[1:]):
        delta_hours = max(0, float(current["at_ms"]) - float(previous["at_ms"])) / 3_600_000
        previous_power = sum(float(g["power_w"]) for g in previous.get("gpus", []))
        current_power = sum(float(g["power_w"]) for g in current.get("gpus", []))
        energy_wh += ((previous_power + current_power) / 2) * delta_hours
    return {
        "available": True, "sample_count": len(samples),
        "gpu_util_mean_pct": round(statistics.fmean(util), 2), "gpu_util_peak_pct": round(max(util), 2),
        "memory_mean_mb": round(statistics.fmean(memory), 2), "memory_peak_mb": round(max(memory), 2),
        "power_mean_w": round(statistics.fmean(power), 2), "power_peak_w": round(max(power), 2),
        "temperature_peak_c": round(max(temperature), 2), "energy_wh": round(energy_wh, 6),
    }


def validate_endpoint(endpoint: str) -> None:
    parsed = urllib.parse.urlparse(endpoint)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise ValueError("endpoint는 http 또는 https URL이어야 합니다.")
    allowed = {h.strip().lower() for h in os.environ.get("ALLOWED_TARGET_HOSTS", "localhost,127.0.0.1,::1").split(",") if h.strip()}
    if "*" not in allowed and parsed.hostname.lower() not in allowed:
        raise ValueError(f"허용되지 않은 대상 호스트입니다: {parsed.hostname}. ALLOWED_TARGET_HOSTS에 추가하세요.")


def gpu_snapshot() -> list[dict[str, Any]]:
    fields = "index,name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw"
    try:
        proc = subprocess.run(
            ["nvidia-smi", f"--query-gpu={fields}", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=3, check=True,
        )
    except (FileNotFoundError, subprocess.SubprocessError):
        return []
    result = []
    for line in proc.stdout.splitlines():
        parts = [x.strip() for x in line.split(",")]
        if len(parts) == 7:
            result.append({
                "index": int(parts[0]), "name": parts[1], "gpu_util_pct": float(parts[2]),
                "memory_used_mb": float(parts[3]), "memory_total_mb": float(parts[4]),
                "temperature_c": float(parts[5]), "power_w": float(parts[6]),
            })
    return result


def environment_snapshot() -> dict[str, Any]:
    gpus = gpu_snapshot()
    return {
        "os": platform.platform(), "python": sys.version.split()[0],
        "processor": platform.processor() or platform.machine(), "hostname": platform.node(),
        "gpus": [{"name": g["name"], "memory_total_mb": g["memory_total_mb"]} for g in gpus],
    }


class GpuSampler:
    def __init__(self, interval: float = .5):
        self.interval, self.samples = interval, []
        self.stop_event = threading.Event()
        self.thread = threading.Thread(target=self._run, daemon=True)

    def _run(self) -> None:
        while not self.stop_event.is_set():
            snap = gpu_snapshot()
            if snap:
                self.samples.append({"at_ms": now_ms(), "gpus": snap})
            self.stop_event.wait(self.interval)

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *_):
        self.stop_event.set()
        self.thread.join(timeout=2)


def benchmark_once(settings: dict[str, Any], sequence: int) -> dict[str, Any]:
    endpoint = settings["endpoint"].rstrip("/")
    url = endpoint if endpoint.endswith("/chat/completions") else endpoint + "/chat/completions"
    body = {
        "model": settings["model"], "messages": [{"role": "user", "content": settings["prompt"]}],
        "stream": True, "temperature": float(settings.get("temperature", 0)),
        "max_tokens": int(settings.get("max_tokens", 256)),
        "stream_options": {"include_usage": True},
    }
    headers = {"Content-Type": "application/json", "Accept": "text/event-stream"}
    if settings.get("api_key"):
        headers["Authorization"] = "Bearer " + settings["api_key"]
    request = urllib.request.Request(url, json.dumps(body).encode(), headers=headers, method="POST")
    started = now_ms()
    first_token_at = None
    content = []
    usage: dict[str, Any] = {}
    chunk_times = []
    try:
        with urllib.request.urlopen(request, timeout=float(settings.get("timeout_seconds", 120))) as response:
            status = response.status
            while True:
                raw = response.readline()
                if not raw:
                    break
                line = raw.decode("utf-8", "replace").strip()
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    break
                try:
                    event = json.loads(data)
                except json.JSONDecodeError:
                    continue
                if event.get("usage"):
                    usage = event["usage"]
                choices = event.get("choices") or []
                delta = (choices[0].get("delta") or {}).get("content") if choices else None
                if delta:
                    stamp = now_ms()
                    if first_token_at is None:
                        first_token_at = stamp
                    chunk_times.append(round(stamp - started, 3))
                    content.append(delta)
        ended = now_ms()
        output_tokens = usage.get("completion_tokens")
        if output_tokens is None:
            output_tokens = max(1, round(len("".join(content)) / 3.5)) if content else 0
        generation_ms = (ended - first_token_at) if first_token_at is not None else None
        inter_chunk = [round(current - previous, 3) for previous, current in zip(chunk_times, chunk_times[1:])]
        return {
            "sequence": sequence, "status": status, "ttft_ms": round(first_token_at - started, 3) if first_token_at else None,
            "total_ms": round(ended - started, 3), "generation_ms": round(generation_ms, 3) if generation_ms is not None else None,
            "output_tokens": output_tokens, "prompt_tokens": usage.get("prompt_tokens"),
            "output_tokens_per_sec": round(output_tokens / (generation_ms / 1000), 3) if generation_ms and output_tokens else None,
            "chunk_offsets_ms": chunk_times, "inter_chunk_ms": inter_chunk,
            "itl_mean_ms": round(statistics.fmean(inter_chunk), 3) if inter_chunk else None,
            "itl_p95_ms": percentile(inter_chunk, .95), "itl_max_ms": round(max(inter_chunk), 3) if inter_chunk else None,
            "response_chars": len("".join(content)), "error": None,
        }
    except (urllib.error.URLError, TimeoutError, ValueError) as exc:
        return {"sequence": sequence, "ttft_ms": None, "total_ms": round(now_ms() - started, 3), "error": str(exc)}


def run_benchmark(settings: dict[str, Any]) -> dict[str, Any]:
    validate_endpoint(settings["endpoint"])
    iterations = max(1, min(int(settings.get("iterations", 3)), 100))
    concurrency = max(1, min(int(settings.get("concurrency", 1)), 32))
    warmup_iterations = max(0, min(int(settings.get("warmup_iterations", 0)), 10))
    sanitized = {k: v for k, v in settings.items() if k != "api_key"}
    sanitized["condition"] = settings.get("condition", "unspecified")
    sanitized["warmup_iterations"] = warmup_iterations
    sanitized["environment"] = environment_snapshot()
    for index in range(warmup_iterations):
        benchmark_once(settings, -(index + 1))
    with GpuSampler() as gpu:
        with ThreadPoolExecutor(max_workers=concurrency) as pool:
            futures = [pool.submit(benchmark_once, settings, i + 1) for i in range(iterations)]
            samples = [future.result() for future in as_completed(futures)]
    samples.sort(key=lambda x: x["sequence"])
    for index, sample in enumerate(samples):
        sample["phase"] = "first-measured" if index == 0 else "steady-state"
    summary = summarize(samples)
    summary["gpu"] = summarize_gpu(gpu.samples)
    total_output_tokens = sum(int(s.get("output_tokens") or 0) for s in samples if not s.get("error"))
    summary["energy_per_output_token_wh"] = (
        round(summary["gpu"]["energy_wh"] / total_output_tokens, 9)
        if summary["gpu"].get("available") and total_output_tokens else None
    )
    run = {
        "id": str(uuid.uuid4()), "source": "openai-compatible-api", "model": settings["model"],
        "endpoint": settings["endpoint"], "settings": sanitized, "samples": samples,
        "summary": summary, "gpu": gpu.samples,
    }
    save_run(run)
    return run


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(STATIC), **kwargs)

    def log_message(self, fmt: str, *args: Any) -> None:
        print(f"[{self.log_date_time_string()}] {fmt % args}")

    def send_json(self, obj: Any, status: int = 200) -> None:
        data = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0"))
        if length > 2_000_000:
            raise ValueError("요청 본문이 너무 큽니다.")
        return json.loads(self.rfile.read(length) or b"{}")

    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/health":
            self.send_json({"ok": True, "gpu": gpu_snapshot(), "db": str(DB_PATH)})
        elif parsed.path == "/api/runs":
            self.send_json({"runs": list_runs()})
        elif parsed.path.startswith("/api/"):
            self.send_json({"error": "not found"}, 404)
        else:
            super().do_GET()

    def do_POST(self) -> None:
        try:
            payload = self.read_json()
            if self.path == "/api/benchmark":
                required = ("endpoint", "model", "prompt")
                if any(not payload.get(k) for k in required):
                    raise ValueError("endpoint, model, prompt가 필요합니다.")
                self.send_json(run_benchmark(payload), 201)
            elif self.path == "/api/browser-measurement":
                samples = payload.get("samples") or []
                if not samples:
                    raise ValueError("samples가 필요합니다.")
                run = {
                    "id": str(uuid.uuid4()), "source": "gpt-edu-browser-e2e", "model": payload.get("model", "GPT Edu"),
                    "endpoint": "browser", "settings": payload.get("settings", {}), "samples": samples,
                    "summary": summarize(samples), "gpu": [],
                }
                save_run(run)
                self.send_json(run, 201)
            else:
                self.send_json({"error": "not found"}, 404)
        except (ValueError, KeyError, json.JSONDecodeError) as exc:
            self.send_json({"error": str(exc)}, 400)
        except Exception as exc:
            self.send_json({"error": f"서버 오류: {exc}"}, 500)


def main() -> None:
    parser = argparse.ArgumentParser(description="LLM inference benchmark lab")
    parser.add_argument("--host", default=os.environ.get("HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", "8080")))
    args = parser.parse_args()
    init_db()
    print(f"Benchmark Lab: http://{args.host}:{args.port}")
    print("Allowed targets:", os.environ.get("ALLOWED_TARGET_HOSTS", "localhost,127.0.0.1,::1"))
    ThreadingHTTPServer((args.host, args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
