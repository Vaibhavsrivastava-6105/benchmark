# 📖 Comprehensive LLM Benchmarking & Evaluation Platform Guide

This guide provides a complete, in-depth reference for **every page**, **button**, **metric**, and **workflow** in the LLM Benchmarking & Evaluation Platform.

---

## 📑 Table of Contents
1. [System Architecture & Overview](#1-system-architecture--overview)
2. [Sidebar Navigation](#2-sidebar-navigation)
3. [Dashboard (`/`)](#3-dashboard-)
4. [New Benchmark Wizard (`/benchmarks/new`)](#4-new-benchmark-wizard-benchmarksnew)
5. [Live Benchmark Execution & Telemetry (`/benchmarks/[id]`)](#5-live-benchmark-execution--telemetry-benchmarksid)
6. [Benchmark Report & Failure Analysis (`/benchmarks/[id]/report`)](#6-benchmark-report--failure-analysis-benchmarksidreport)
7. [Multi-Model Cross-Engine Matrix (`/multimodel`)](#7-multi-model-cross-engine-matrix-multimodel)
8. [Run Comparison & Diff Matrix (`/compare`)](#8-run-comparison--diff-matrix-compare)
9. [Model Library & GGUF Scanner (`/models`)](#9-model-library--gguf-scanner-models)
10. [Providers & Engine Management (`/providers` & `/providers/[id]`)](#10-providers--engine-management-providers--providersid)
11. [Hardware Telemetry Center (`/hardware`)](#11-hardware-telemetry-center-hardware)
12. [Global Request History & Dataset Generator (`/requests`)](#12-global-request-history--dataset-generator-requests)
13. [Evaluation Datasets Manager (`/datasets`)](#13-evaluation-datasets-manager-datasets)
14. [System Event Logs (`/logs`)](#14-system-event-logs-logs)

---

## 1. System Architecture & Overview

- **Frontend:** Next.js 16 (React 19, Tailwind CSS, Lucide Icons, Recharts).
- **Backend:** FastAPI (Python 3.11+, SQLAlchemy, SQLite, Pydantic v2).
- **Telemetry Engine:** Direct hardware polling via `psutil` (CPU/RAM) and `pynvml` (GPU Core Util, VRAM usage).
- **Supported Serving Engines:**
  - **Ollama:** HTTP REST API on port `11434`.
  - **llama.cpp:** Native C++ `llama-server.exe` on port `8080`.
  - **Hugging Face Transformers:** In-process PyTorch execution engine.
  - **vLLM / OpenAI-Compatible:** Remote or WSL2 endpoints on port `8000`.

---

## 2. Sidebar Navigation

Located permanently on the left side of the screen for one-click access:
- **Dashboard (`/`):** Quick stats, active engines, recent runs, and quick action shortcuts.
- **New Benchmark (`/benchmarks/new`):** 5-step wizard to configure and launch a performance & quality benchmark.
- **Multi-Model (`/multimodel`):** Matrix execution across multiple models and multiple serving backends simultaneously.
- **Compare Runs (`/compare`):** Multi-run comparison matrix, radar charts, weight sliders, and automated winner verdict.
- **Model Library (`/models`):** Local `.gguf` file discovery and custom model registry.
- **Providers (`/providers`):** Health check, status badges, and engine details.
- **Hardware (`/hardware`):** Real-time hardware telemetry gauges (CPU, GPU, RAM, VRAM).
- **Global Requests (`/requests`):** Individual request trace logs and traffic-to-dataset export.
- **Datasets (`/datasets`):** Evaluation Prompt Suite upload, export, and deletion.
- **System Logs (`/logs`):** Audit trail of engine actions, run lifecycles, and errors.

---

## 3. Dashboard (`/`)

### Top Header
- **New Benchmark Button:** Navigates directly to the 5-step Benchmark Creation Wizard (`/benchmarks/new`).
- **Refresh Data Button:** Re-polls all active metrics, engine states, and run lists from the backend.

### KPI Cards
- **Total Benchmark Runs:** Count of all historical benchmark runs stored in the database.
- **Avg Tokens / Second:** Aggregate throughput calculated across all completed requests.
- **Avg TTFT (Time to First Token):** Average initial token latency in milliseconds.
- **Active Serving Engines:** Count of engines currently in an `ONLINE` state.

### Live Engine Status Grid
- Displays individual cards for **Local Ollama**, **Local llama.cpp**, **Local Hugging Face Transformers**, and **Local vLLM**.
- **Status Badge:** Live `ONLINE` / `OFFLINE` status.
- **Network Latency:** Real-time round-trip HTTP ping in milliseconds.
- **Action Links:** Clicking any engine opens its dedicated settings page (`/providers/[id]`).

### Benchmark History Table
- **Search Bar:** Filters benchmark runs in real time by name, model, or provider.
- **Status Badges:** `QUEUED`, `RUNNING`, `COMPLETED`, `FAILED`, `CANCELLED`.
- **View Run Link:** Opens the Live Telemetry & Progress dashboard (`/benchmarks/[id]`).
- **Report Link:** Opens the Executive Report and Analysis page (`/benchmarks/[id]/report`).

---

## 4. New Benchmark Wizard (`/benchmarks/new`)

The benchmark wizard guides you through a 5-step configuration:

### Step 1: Benchmark Details
- **Benchmark Name Input:** Custom label for your test run.
- **Benchmark Description:** Optional notes explaining the goal of the test.

### Step 2: Select Task Suites (Datasets)
- Checkboxes for the built-in datasets:
  - `Basic Reasoning`: Arithmetic and logical deduction.
  - `Structured JSON`: Schema compliance tests.
  - `Coding Tasks`: Python syntax and algorithmic challenges.
  - `Context Scaling`: TTFT and KV-cache scaling up to 8k tokens.
  - `GSM8k Math`: Multi-step arithmetic reasoning.

### Step 3: Select Providers & Models
- Select one or more active serving engines.
- Choose which loaded model weights to benchmark against.

### Step 4: Concurrency & Load Configuration
- **Concurrency Slider (1 to 64):** Simulates parallel concurrent user requests.
- **Warmup Requests Input:** Number of untracked requests sent to prime the KV-cache and GPU memory before collecting metrics.
- **Repetitions Input:** Number of times each prompt in the suite is executed.
- **Temperature & Top-P Sliders:** Sampling parameters for the LLM.
- **Max Output Tokens:** Upper limit on generated tokens.

### Step 5: Review & Launch
- **Summary Preview:** Shows total calculated requests, concurrency level, and target providers.
- **Start Benchmark Button:** Submits the configuration, creates the database record, and queues background asynchronous execution.

---

## 5. Live Benchmark Execution & Telemetry (`/benchmarks/[id]`)

### Top Header & Controls
- **Cancel Run Button:** Stops a running benchmark immediately and marks pending requests as cancelled.
- **Export Run Button:** Downloads the benchmark results in JSON, CSV, or Markdown.
- **View Report Button:** Navigates directly to the Executive Report (`/benchmarks/[id]/report`).

### Live Telemetry Cards
- **Throughput Gauge:** Real-time generated tokens per second (t/s).
- **TTFT Meter:** Milliseconds elapsed before the first token is emitted.
- **GPU Core & VRAM Monitor:** Live GPU load percentage and VRAM utilization in MB/GB.
- **CPU & RAM Monitor:** Host CPU utilization percentage and RSS memory footprint.

### Request Log Stream
- Real-time tabular stream of individual requests as they complete:
  - Request ID, Prompt Category, Status, Tokens Generated, TTFT (ms), Total Latency (ms), and Quality Pass/Fail status.

### Right-Side Engine Terminals
- Real-time log streams for each engine:
  - **FastAPI Backend:** API route dispatches and worker scheduler logs.
  - **llama.cpp:** C++ slot allocation, threadpool metrics, and prompt eval speeds.
  - **Ollama:** Model load timers, GIN requests, and GPU VRAM layer mappings.
  - **Hugging Face Transformers:** In-process PyTorch pipeline status.

---

## 6. Benchmark Report & Failure Analysis (`/benchmarks/[id]/report`)

### Executive Overview Cards
- **Overall Quality Pass Rate:** Percentage of responses that passed automated evaluators.
- **P50 / P95 / P99 Latency:** High-percentile latency measurements.
- **Token Efficiency:** Cost and energy metrics per 1,000 tokens.

### Automated Failure Categorization
- Grouped breakdown of all failure root causes:
  - `PROVIDER_ERROR`: Connection resets, timeouts, or out-of-memory errors.
  - `WRONG_ANSWER`: Hallucinated or incorrect factual assertions.
  - `BAD_FORMAT`: Invalid JSON output or violated schema constraints.
  - `TRUNCATED`: Reached max token limit before completing generation.

### Human-in-the-Loop Alignment Grading
- Interactive evaluation buttons for human reviewers on each request:
  - ?? **Correct:** Output accurately answers prompt.
  - ?? **Incorrect:** Output is wrong or factually inaccurate.
  - ?? **Partial:** Output is partially accurate but incomplete.
  - ?? **Hallucinated:** Model fabricated non-existent information.
  - ?? **Bad Format:** Model output failed formatting guidelines.

---

## 7. Multi-Model Cross-Engine Matrix (`/multimodel`)

- **Purpose:** Compare multiple models across multiple serving engines simultaneously in a single benchmark run.
- **Engine/Model Matrix Grid:** Select any combination of engines (e.g. Ollama vs. llama.cpp) paired with different models (e.g. Qwen 0.5B vs. Qwen 7B).
- **Run Multi-Model Benchmark Button:** Dispatches the matrix benchmark across all selected permutations.

---

## 8. Run Comparison & Diff Matrix (`/compare`)

- **Multi-Run Selector:** Check multiple historical benchmark runs to compare side-by-side.
- **Baseline Selection Dropdown:** Choose one run as the baseline to compute percentage deltas (?).
- **Radar Comparison Chart:** Multi-dimensional visualization comparing Throughput, TTFT, Accuracy, and Resource Footprint.
- **Custom Metric Weight Sliders:**
  - Adjust the relative importance of **Throughput**, **Latency (TTFT)**, **Quality Pass Rate**, and **Memory Footprint**.
- **Automated Winner Verdict:** The system computes the weighted composite score and crowns the winning engine/model combination.

---

## 9. Model Library & GGUF Scanner (`/models`)

### GGUF Model Scanner
- **Scan Local Models Button:** Scans local directories for `.gguf` weight files.
- Automatically detects quantization levels (`Q4_K_M`, `Q8_0`, `FP16`) and context lengths.

### Register New Model Form
- **Model Name / HuggingFace ID:** E.g. `Qwen/Qwen2.5-0.5B-Instruct`.
- **Architecture & Family:** E.g. `Qwen`, `Llama`, `Mistral`, `Gemma`.
- **Parameter Count & Quantization:** Metadata fields for model tracking.
- **Register Button:** Adds the model to the local library.

---

## 10. Providers & Engine Management (`/providers` & `/providers/[id]`)

### Engine Cards & Status Badges
- Lists all configured inference providers.
- **Test Connection Button:** Performs an immediate HTTP health check and queries loaded models.
- **Start / Stop Engine Button:** Launches or terminates local engine background processes.

### Provider Detail Page (`/providers/[id]`)
- **API Base URL Configuration:** Edit engine endpoints (e.g. `http://127.0.0.1:11434/v1`).
- **API Key Field:** Optional Bearer token for authenticated endpoints.
- **Loaded Models List:** Lists all models currently resident in engine memory.

---

## 11. Hardware Telemetry Center (`/hardware`)

- **Host CPU Gauge:** Real-time percentage across all physical and logical cores.
- **Host RAM Gauge:** Used vs. Total host RAM in Gigabytes.
- **GPU Core Load:** Real-time NVIDIA GPU utilization percentage.
- **GPU VRAM Allocation:** Dedicated video memory usage with temperature and power draw telemetry.

---

## 12. Global Request History & Dataset Generator (`/requests`)

- **Global Trace Table:** Chronological log of every single request across all runs.
- **Search & Filter:** Filter by provider, model name, prompt category, or status.
- **Inspect Request Dialog:** Click any row to view the full system prompt, user prompt, and generated response.
- **Convert to Dataset Button:** Select multiple request traces and click **"Export Selected as Prompt Suite"** to create a new benchmark dataset from real traffic.

---

## 13. Evaluation Datasets Manager (`/datasets`)

- **Upload CSV Button:** Upload a custom CSV containing `category`, `prompt`, and `expected_answer` columns.
- **Search Datasets Input:** Live text filter for existing datasets.
- **Download JSON/CSV Button:** Exports a dataset to disk.
- **Delete Dataset (Trash) Button:** Permanently deletes a dataset and its prompts with confirmation.

---

## 14. System Event Logs (`/logs`)

- **Real-Time Event Table:** Shows timestamped audit logs for all system operations.
- **Severity Filters:** Filter by `INFO`, `WARNING`, or `ERROR`.
- **Source Filter:** Filter logs by component (`Runner`, `Evaluator`, `Telemetry`, `API`).
