import datetime
from jinja2 import Template
from typing import Any, Dict, List
from app.models import BenchmarkRun

HTML_TEMPLATE = """
<!DOCTYPE html>
<html lang="en" class="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>LLM Benchmark Lab - Run #{{ run.id }} Report</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script>
        tailwind.config = {
            darkMode: 'class',
            theme: {
                extend: {
                    colors: {
                        zinc: {
                            950: '#09090b',
                        }
                    }
                }
            }
        }
    </script>
</head>
<body class="bg-zinc-950 text-zinc-100 font-sans p-8 max-w-5xl mx-auto min-h-screen">
    <!-- Header -->
    <div class="border-b border-zinc-800 pb-6 mb-8 flex justify-between items-start">
        <div>
            <h1 class="text-3xl font-bold tracking-tight text-white">LLM Benchmark Lab</h1>
            <p class="text-zinc-400 text-sm mt-1">Automated Performance Evaluation & Telemetry Report</p>
        </div>
        <div class="text-right">
            <span class="text-xs font-mono bg-zinc-900 border border-zinc-800 px-3 py-1 rounded-full text-cyan-400">
                RUN ID: #{{ run.id }}
            </span>
            <p class="text-xs text-zinc-500 mt-2">Generated on: {{ current_date }}</p>
        </div>
    </div>

    <!-- Executive Summary -->
    <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div class="bg-zinc-900/60 border border-zinc-800 rounded-xl p-5">
            <span class="text-xs text-zinc-500 font-bold uppercase tracking-wider">Target Model</span>
            <div class="text-lg font-bold text-zinc-200 mt-1 truncate">{{ run.model_name }}</div>
            <div class="text-xs text-zinc-400 mt-1">Quantization: {{ run.quantization or 'N/A' }}</div>
        </div>
        <div class="bg-zinc-900/60 border border-zinc-800 rounded-xl p-5">
            <span class="text-xs text-zinc-500 font-bold uppercase tracking-wider">Overall Workload</span>
            <div class="text-lg font-bold text-zinc-200 mt-1">{{ run.repetitions }} reps @ concurrency {{ run.concurrency }}</div>
            <div class="text-xs text-zinc-400 mt-1">Parameters: Temp {{ run.temperature or 0.0 }} | Max Tokens {{ run.max_tokens or 128 }}</div>
        </div>
        <div class="bg-zinc-900/60 border border-zinc-800 rounded-xl p-5">
            <span class="text-xs text-zinc-500 font-bold uppercase tracking-wider">Benchmark Status</span>
            <div class="text-lg font-bold mt-1 uppercase text-emerald-400">
                {{ run.status }}
            </div>
            <div class="text-xs text-zinc-400 mt-1">Completed: {{ run.updated_at.strftime('%Y-%m-%d %H:%M:%S') }}</div>
        </div>
    </div>

    <!-- Recommendation / Verdict -->
    {% if verdict %}
    <div class="bg-zinc-900 border border-cyan-900/50 rounded-xl p-6 mb-8">
        <h3 class="text-sm uppercase font-bold tracking-wider text-cyan-400 mb-2">Verdict & Recommendation</h3>
        <p class="text-sm text-zinc-300 leading-relaxed font-mono">
            {{ verdict }}
        </p>
    </div>
    {% endif %}

    <!-- Runtime Performance Matrix -->
    <div class="mb-8">
        <h2 class="text-xl font-bold text-zinc-200 mb-4">Runtime Performance Summary</h2>
        <div class="overflow-x-auto border border-zinc-800 rounded-xl bg-zinc-900/20">
            <table class="w-full text-sm text-left border-collapse">
                <thead>
                    <tr class="border-b border-zinc-800 bg-zinc-900/40 text-xs font-bold uppercase text-zinc-400">
                        <th class="p-4">Runtime Provider</th>
                        <th class="p-4">Avg Speed (tok/s)</th>
                        <th class="p-4">Avg TTFT (ms)</th>
                        <th class="p-4">Avg Latency (ms)</th>
                        <th class="p-4">Avg VRAM (GB)</th>
                        <th class="p-4">Success Rate</th>
                        <th class="p-4">Quality Score</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-zinc-850">
                    {% for item in provider_summaries %}
                    <tr class="hover:bg-zinc-900/20">
                        <td class="p-4 font-bold text-white">{{ item.name }}</td>
                        <td class="p-4 text-cyan-400">{{ item.avg_speed }}</td>
                        <td class="p-4">{{ item.avg_ttft }}</td>
                        <td class="p-4">{{ item.avg_latency }}</td>
                        <td class="p-4">{{ item.avg_vram }}</td>
                        <td class="p-4">
                            <span class="px-2 py-0.5 rounded text-xs {{ 'bg-emerald-950 text-emerald-400 border border-emerald-800' if item.success_rate == '100.0%' else 'bg-amber-950 text-amber-400 border border-amber-800' }}">
                                {{ item.success_rate }}
                            </span>
                        </td>
                        <td class="p-4 text-amber-400 font-bold">{{ item.quality }}%</td>
                    </tr>
                    {% endfor %}
                </tbody>
            </table>
        </div>
    </div>

    <!-- Detailed Request Log -->
    <div class="mb-8">
        <h2 class="text-xl font-bold text-zinc-200 mb-4">Detailed Request Logs</h2>
        <div class="overflow-x-auto border border-zinc-800 rounded-xl bg-zinc-900/20 max-h-96 overflow-y-auto">
            <table class="w-full text-xs text-left border-collapse">
                <thead>
                    <tr class="border-b border-zinc-800 bg-zinc-900/40 text-xs font-bold uppercase text-zinc-400 sticky top-0">
                        <th class="p-3">ID</th>
                        <th class="p-3">Provider</th>
                        <th class="p-3">Prompt ID</th>
                        <th class="p-3">TTFT (ms)</th>
                        <th class="p-3">Latency (ms)</th>
                        <th class="p-3">Speed (tok/s)</th>
                        <th class="p-3">Score</th>
                        <th class="p-3">Status</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-zinc-850">
                    {% for req in requests %}
                    <tr class="hover:bg-zinc-900/20 font-mono">
                        <td class="p-3 text-zinc-500">{{ req.id }}</td>
                        <td class="p-3 text-zinc-300 font-sans font-bold">{{ req.provider_name }}</td>
                        <td class="p-3">Prompt #{{ req.prompt_id }}</td>
                        <td class="p-3">{{ req.ttft_ms if req.ttft_ms else 'N/A' }}</td>
                        <td class="p-3">{{ req.total_time_ms }}</td>
                        <td class="p-3 text-cyan-400">{{ req.speed }}</td>
                        <td class="p-3 text-amber-400">{{ req.score }}</td>
                        <td class="p-3">
                            <span class="px-1.5 py-0.5 rounded text-[10px] {{ 'bg-emerald-950 text-emerald-400' if not req.error else 'bg-red-950 text-red-400' }}">
                                {{ 'SUCCESS' if not req.error else 'ERROR' }}
                            </span>
                        </td>
                    </tr>
                    {% endfor %}
                </tbody>
            </table>
        </div>
    </div>

    <!-- Footer -->
    <div class="border-t border-zinc-800 pt-6 mt-12 text-center text-xs text-zinc-500">
        <p>LLM Benchmark Lab - Open-Source Inference Performance Profiler</p>
    </div>
</body>
</html>
"""

def generate_html_report(run: BenchmarkRun, requests_list: List[Any], telemetry_list: List[Any], verdict: str) -> str:
    """
    Renders the benchmark run logs into a beautiful styled HTML report template.
    """
    # Group and compute averages per provider
    grouped_data: Dict[str, List[Any]] = {}
    for req in requests_list:
        p_name = req.provider_name
        if p_name not in grouped_data:
            grouped_data[p_name] = []
        grouped_data[p_name].append(req)
        
    provider_summaries = []
    for p_name, reqs in grouped_data.items():
        speeds = [r.output_tokens / (r.total_time_ms / 1000.0) for r in reqs if not r.error and r.total_time_ms > 0]
        ttfts = [r.ttft_ms for r in reqs if not r.error and r.ttft_ms is not None]
        latencies = [r.total_time_ms for r in reqs if not r.error]
        
        # Calculate success rate
        errors = [r for r in reqs if r.error]
        success_rate = (len(reqs) - len(errors)) / len(reqs) * 100.0 if reqs else 0.0
        
        # Calculate average quality score (percentage)
        quality_scores = [r.score for r in reqs if not r.error and r.score is not None]
        avg_quality = (sum(quality_scores) / len(quality_scores) * 100.0) if quality_scores else 100.0
        
        # Calculate avg vram usage (from telemetry)
        vram_samples = [t.gpu_utilization.get("vram_used", 0) / (1024**3) for t in telemetry_list if t.gpu_utilization and isinstance(t.gpu_utilization, dict)]
        avg_vram = f"{round(sum(vram_samples)/len(vram_samples), 2)} GB" if vram_samples else "N/A"
        
        provider_summaries.append({
            "name": p_name,
            "avg_speed": f"{round(sum(speeds)/len(speeds), 1)} tok/s" if speeds else "N/A",
            "avg_ttft": f"{round(sum(ttfts)/len(ttfts), 1)} ms" if ttfts else "N/A",
            "avg_latency": f"{round(sum(latencies)/len(latencies), 1)} ms" if latencies else "N/A",
            "avg_vram": avg_vram,
            "success_rate": f"{round(success_rate, 1)}%",
            "quality": int(avg_quality)
        })

    # Prepare formatted requests list
    formatted_requests = []
    for req in requests_list:
        speed = round(req.output_tokens / (req.total_time_ms / 1000.0), 1) if not req.error and req.total_time_ms > 0 else 0.0
        formatted_requests.append({
            "id": req.id,
            "provider_name": req.provider_name,
            "prompt_id": req.prompt_id,
            "ttft_ms": round(req.ttft_ms, 1) if req.ttft_ms else None,
            "total_time_ms": round(req.total_time_ms, 1),
            "speed": f"{speed} tok/s" if speed else "N/A",
            "score": round(req.score, 2) if req.score is not None else 1.0,
            "error": req.error
        })

    template = Template(HTML_TEMPLATE)
    return template.render(
        run=run,
        current_date=datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        provider_summaries=provider_summaries,
        requests=formatted_requests,
        verdict=verdict
    )
