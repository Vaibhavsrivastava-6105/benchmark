# BenchLab Architecture

BenchLab is built on a decoupled, asynchronous microservices architecture.

## 1. Frontend (Next.js)
- Runs on React 18 / Next.js App Router
- Uses Tailwind CSS for styling and Recharts for live telemetry graphs
- Communicates with the backend exclusively via REST APIs and Server-Sent Events (SSE)

## 2. Backend (FastAPI)
- **API Layer**: Exposes REST endpoints to manage Models, Providers, and Prompt Suites
- **Execution Engine (unner.py)**: An syncio-driven task coordinator that dynamically multiplexes prompts across all active inference providers.
- **Unified Providers (openai_compatible.py)**: All providers (including Ollama and vLLM) are coerced into standard OpenAI Chat completions.
- **Hardware Monitor (	elemetry.py)**: Runs as a background daemon, polling psutil and GPUtil to permanently store host health in SQLite.

## 3. Database (SQLite)
- Stores SystemMetrics, SystemEventLog, BenchmarkRequest, and ProviderHealth.
- Alembic handles schema migrations.
