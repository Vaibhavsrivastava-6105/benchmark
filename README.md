# ⚡ LLM Evaluation & Experimentation Platform (BenchLab)

A production-grade, extensible LLM benchmarking and evaluation platform to systematically evaluate, compare, and benchmark multiple Large Language Models, inference providers, runtimes, prompts, and configurations under controlled, reproducible conditions.

---

## 📋 Table of Contents
1. [System Prerequisites](#-system-prerequisites)
2. [Quickstart Installation](#-quickstart-installation)
   - [Backend Setup (FastAPI)](#1-backend-setup-python-fastapi)
   - [Frontend Setup (Next.js)](#2-frontend-setup-nextjs)
3. [Serving Engine Setup](#-serving-engine-setup)
   - [Ollama](#1-ollama-easiest-local-setup)
   - [llama.cpp (Native C++)](#2-llamacpp-high-efficiency-gguf)
   - [Hugging Face Transformers (In-Process PyTorch)](#3-hugging-face-transformers-in-process)
   - [vLLM (High-Throughput PagedAttention)](#4-vllm-production-serving)
4. [Platform Capabilities](#-platform-capabilities)
5. [Public Sharing (Cloudflare Tunnel)](#-public-sharing-cloudflare-tunnel)
6. [Troubleshooting & FAQ](#-troubleshooting--faq)

---

## 💻 System Prerequisites

Before getting started, make sure your laptop or desktop meets the following requirements:

| Component | Minimum Requirement | Recommended |
| :--- | :--- | :--- |
| **Operating System** | Windows 10/11, macOS 12+, or Linux | Windows 11 (with WSL2) or Ubuntu 22.04+ |
| **Python** | Python 3.10+ | Python 3.11 |
| **Node.js** | Node.js v18.0.0+ | Node.js v20 LTS or v22 LTS |
| **RAM** | 8 GB RAM | 16 GB+ RAM |
| **GPU (Optional)** | Integrated CPU / Apple Silicon | NVIDIA GPU (RTX 3060/4060 or higher) with CUDA |
| **Git** | Installed and in `PATH` | Git 2.30+ |

---

## 🚀 Quickstart Installation

### Step 1: Clone the Repository
```bash
git clone https://github.com/Vaibhavsrivastava-6105/benchmark.git
cd benchmark
```

---

### Step 2: Backend Setup (Python FastAPI)

1. Open a terminal and navigate to the `backend` directory:
   ```bash
   cd backend
   ```

2. Create and activate a Python virtual environment:
   * **Windows (PowerShell):**
     ```powershell
     python -m venv .venv
     .\.venv\Scripts\Activate.ps1
     ```
   * **macOS / Linux:**
     ```bash
     python3 -m venv .venv
     source .venv/bin/activate
     ```

3. Install the required Python packages:
   ```bash
   pip install fastapi uvicorn sqlalchemy pydantic psutil requests python-multipart httpx torch transformers numpy
   ```
   *(Optional for NVIDIA GPU telemetry on Windows: `pip install pynvml`)*

4. Launch the FastAPI server:
   ```bash
   uvicorn app.main:app --port 8006 --reload
   ```
   ✅ *Backend is running on `http://127.0.0.1:8006`.*

---

### Step 3: Frontend Setup (Next.js)

1. Open a **second terminal window** in the project root and navigate to `frontend`:
   ```bash
   cd frontend
   ```

2. Install Node.js dependencies:
   ```bash
   npm install
   ```

3. Start the Next.js development server:
   ```bash
   npm run dev
   ```
   ✅ *Frontend UI is running on `http://localhost:3000`.*

---

## 🔌 Serving Engine Setup

The platform natively supports 4 distinct inference runtimes. You can use any combination of them:

```
┌─────────────────────────────────────────────────────────────┐
│                    Next.js Dashboard (:3000)                │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│                    FastAPI Backend (:8006)                  │
└──────┬──────────────┬─────────────────┬──────────────┬──────┘
       │              │                 │              │
┌──────▼──────┐┌──────▼──────┐   ┌──────▼──────┐┌──────▼──────┐
│   Ollama    ││  llama.cpp  │   │Transformers ││    vLLM     │
│  (:11434)   ││   (:8080)   │   │(In-Process) ││   (:8000)   │
└─────────────┘└─────────────┘   └─────────────┘└─────────────┘
```

---

### 1. Ollama (Easiest Local Setup)
* **Platforms:** Windows, macOS, Linux
1. Download and install Ollama from [ollama.com](https://ollama.com/).
2. Pull a lightweight model (e.g. Qwen 2.5 0.5B):
   ```bash
   ollama pull qwen2.5:0.5b
   ```
3. Start the Ollama daemon:
   ```bash
   ollama serve
   ```
   *Ollama runs on port `11434`. The platform auto-detects it as **ONLINE**.*

---

### 2. llama.cpp (High-Efficiency GGUF)
* **Platforms:** Windows, macOS, Linux
* **Windows (Pre-bundled):** The repository includes `backend/bin/llama-cpp/llama-server.exe` and a quantized model.
  ```powershell
  # Run from the project root:
  .\backend\bin\llama-cpp\llama-server.exe -m .\backend\bin\llama-cpp\qwen2.5-0.5b-instruct-q4_k_m.gguf --port 8080 --host 127.0.0.1
  ```
* **macOS (Apple Silicon / Metal):**
  ```bash
  brew install llama.cpp
  llama-server -m /path/to/model.gguf --port 8080 --host 127.0.0.1
  ```
* **Linux:**
  ```bash
  git clone https://github.com/ggerganov/llama.cpp
  cd llama.cpp && make
  ./llama-server -m /path/to/model.gguf --port 8080 --host 127.0.0.1
  ```

---

### 3. Hugging Face Transformers (In-Process)
* **Platforms:** Windows, macOS, Linux
* **No external server required!**
* When selected, the backend uses PyTorch `AutoModelForCausalLM` directly inside the Python process with CUDA FP16/BF16 auto-mapping.

---

### 4. vLLM (Production Serving)
* **Platforms:** Linux / Windows WSL2 (NVIDIA GPU required)
1. Install vLLM in your Linux/WSL2 environment:
   ```bash
   pip install vllm
   ```
2. Start the OpenAI-compatible vLLM server:
   ```bash
   python3 -m vllm.entrypoints.openai.api_server --model Qwen/Qwen2.5-0.5B-Instruct --port 8000 --host 0.0.0.0
   ```
   *The platform auto-detects vLLM on port `8000` as **ONLINE**.*

---

## 🌟 Platform Capabilities

1. **5-Step Benchmark Wizard (`/benchmarks/new`):**
   - Configurable temperature, top-p, max tokens, concurrency, warm-ups, repetitions, and baseline regression selection.
2. **Real-Time Live Telemetry (`/benchmarks/[id]`):**
   - Server-Sent Events (SSE) streaming tokens/sec, TTFT, progress meters, and independent engine terminal log windows.
3. **Comprehensive Executive Report (`/benchmarks/[id]/report`):**
   - Quality pass rates, latency distributions (P50, P95, P99), automated failure root-cause categorization, and human evaluation grading.
4. **Side-by-Side Run Comparison & Dynamic Weight Sliders (`/compare`):**
   - Dynamic weight sliders with pre-built profiles (*Balanced*, *Local DX*, *Production*, *Low Latency*, *Low VRAM*), signed delta diffs ($\pm\Delta$), and radar charts.
5. **Pareto-Optimal Use-Case Recommendations (`/compare`):**
   - Automated identification of *Best for Reasoning*, *Best for Structured Extraction*, *Best for Coding*, *Fastest Engine*, *Most Reliable*, and *Pareto Optimal Ratio*.
6. **Continuous Evaluation & Traffic-to-Dataset Converter (`/requests`):**
   - Convert production request traces into structured evaluation datasets with one click.
7. **Multi-Format Export:**
   - Download reports and datasets as JSON, CSV, or Markdown.

---

## 🌐 Public Sharing (Cloudflare Tunnel)

To share your running benchmark instance with teammates or across the internet without opening router ports:
```powershell
# From the project root:
.\cloudflared.exe tunnel --url http://localhost:3000
```
This generates a secure, free public URL (e.g. `https://xxxx.trycloudflare.com`).

---

## 🛠️ Troubleshooting & FAQ

### 1. Port 8006 is already in use (`[Errno 10048]`)
On Windows, a previously killed terminal may leave a background Python process listening on port `8006`. Run:
```powershell
Get-Process python | Stop-Process -Force
```
Then start the backend again.

### 2. vLLM shows as OFFLINE
vLLM requires a Linux environment or Windows WSL2 with an NVIDIA GPU. If you are on native Windows without WSL2, use **Ollama**, **llama.cpp**, or **Transformers**, which run natively on Windows.

### 3. Models not appearing in dropdown
Click **"Scan Folder"** on the **Model Library (`/models`)** page to auto-index local `.gguf` files, or pull models in Ollama via `ollama pull <model_name>`.
