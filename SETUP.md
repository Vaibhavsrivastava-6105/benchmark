# BenchLab Setup Guide

BenchLab is a Next.js (frontend) and FastAPI (backend) application designed to benchmark large language models across multiple inference providers locally and in the cloud.

## Prerequisites

- Python 3.10+
- Node.js 18+
- (Optional) NVIDIA GPU for local inference (vLLM, Ollama, Transformers)

## Quick Start

We have provided a universal setup script that will automatically download dependencies and initialize both the backend and frontend.

`ash
python setup.py
`

### Manual Setup (Backend)

`ash
cd backend
python -m venv .venv
# Activate the virtual environment:
# Windows: .venv\Scripts\activate
# Unix: source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --port 8001
`

### Manual Setup (Frontend)

`ash
cd frontend
npm install
npm run dev
`

## Adding Providers
Once the app is running on http://localhost:3000, navigate to the **Providers** tab to add your local runtimes (e.g. http://127.0.0.1:11434 for Ollama) or Cloud API keys (e.g. Hugging Face, Cerebras, DeepSeek).
