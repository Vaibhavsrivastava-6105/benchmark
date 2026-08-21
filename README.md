# BenchLab

A powerful, high-performance web dashboard to benchmark, evaluate, and compare local and cloud AI models (LLMs).

## Getting Started

1. Set up the Python virtual environment and install backend dependencies:
   `ash
   cd backend
   python -m venv .venv
   .\.venv\Scripts\activate
   pip install -r requirements.txt
   `

2. Install frontend dependencies:
   `ash
   cd frontend
   npm install
   `

3. Start the Backend API (runs on port 8001):
   `ash
   cd backend
   .\.venv\Scripts\activate
   uvicorn app.main:app --port 8001
   `

4. Start the Frontend UI (runs on port 3000):
   `ash
   cd frontend
   npm run dev
   `

## Running Local Runtimes (Ollama, vLLM, llama.cpp, Hugging Face)

BenchLab natively supports talking to local engines. If you want to benchmark models locally on your GPU, we have provided an automated setup script that downloads the required CUDA binaries and PyTorch models for Windows:

1. Run the local setup script:
   `powershell
   python setup.py
   `

2. **Ollama**: Download the Ollama desktop app from ollama.com. Run ollama run llama3. BenchLab will automatically connect to it.
3. **llama.cpp**: Run the server using the binary downloaded by the setup script:
   `powershell
   .\backend\bin\llama-cpp\llama-server.exe --model backend\bin\llama-cpp\model.gguf --port 8080
   `
4. **vLLM**: Ensure Docker Desktop is installed and running with WSL2/NVIDIA support, then run:
   `powershell
   docker run --gpus all -p 8000:8000 --ipc=host vllm/vllm-openai:latest --model Qwen/Qwen2.5-0.5B
   `
5. **Transformers**: Once setup.py finishes installing PyTorch, BenchLab will automatically run Transformers natively in the background when you select it.


### 4. High-End GPUs (vLLM)
If you have a native Linux machine or a Windows PC with a high-end GPU (e.g., RTX 3090, 4090) and Docker installed, you can use vLLM for extreme throughput.

`ash
docker run --gpus all -p 8000:8000 --ipc=host vllm/vllm-openai:latest --model Qwen/Qwen2.5-0.5B-Instruct
`
*Note: vLLM requires Unified Virtual Addressing (UVA). It may crash on smaller laptop GPUs running inside Windows WSL2.*
\n## Public Internet Tunnel
To expose your local dashboard to the internet for a presentation or remote access, download cloudflared and run:
`powershell
.\cloudflared.exe tunnel --url http://127.0.0.1:3000
`
