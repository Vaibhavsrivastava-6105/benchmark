# BenchLab Final Hardware Report

## Context
This project was designed and built on a Windows machine utilizing an NVIDIA RTX 3050 (6GB VRAM) laptop GPU running WSL2.

## Key Findings

1. **vLLM Constraints**: 
vLLM fundamentally struggles on lower-end hardware, specifically in Windows WSL2 environments. It strictly demands Unified Virtual Addressing (UVA) for block tables. Because WSL2 cannot pin memory across the Linux/Windows host boundary, it crashes with RuntimeError: UVA is not available on an RTX 3050. It remains recommended only for native Linux enterprise deployments.

2. **Simultaneous Execution limits**:
Executing multiple local engines (e.g., loading a model into Ollama and Hugging Face Transformers simultaneously) on a 6GB VRAM card results in an immediate CUDA Out-Of-Memory (OOM) crash.

3. **The Solution (Sequential Engine)**:
BenchLab implements a strict "Sequential Execution" engine mode. It fires prompts against one provider, finishes, runs PyTorch garbage collection (	orch.cuda.empty_cache()), and then proceeds to the next engine. This permanently stabilizes the benchmarking suite for lower-end hardware.

## Recommendations
- **For < 8GB VRAM (Laptops)**: Use Ollama or llama.cpp purely sequentially.
- **For > 24GB VRAM (Workstations)**: Enable Simultaneous Execution in BenchLab step 3 to run vLLM and HuggingFace pipelines in parallel.
