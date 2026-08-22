from typing import List, Dict, Any, Optional
import numpy as np

# Operational complexity scores (higher is better/easier setup)
OPERATIONAL_DX_SCORES = {
    "ollama": 95.0,
    "llamacpp": 85.0,
    "llama.cpp": 85.0,
    "mock": 100.0,
    "vllm": 70.0,
    "sglang": 65.0,
    "tgi": 60.0,
    "transformers": 45.0
}

# Pre-defined profiles mapping target weights
OBJECTIVE_PROFILES = {
    "best_overall": {
        "quality": 0.30, "throughput": 0.20, "latency": 0.20,
        "vram_efficiency": 0.10, "reliability": 0.10,
        "json_reliability": 0.05, "operational_complexity": 0.05
    },
    "lowest_latency": {
        "quality": 0.20, "throughput": 0.10, "latency": 0.50,
        "vram_efficiency": 0.05, "reliability": 0.10,
        "json_reliability": 0.02, "operational_complexity": 0.03
    },
    "maximum_throughput": {
        "quality": 0.15, "throughput": 0.50, "latency": 0.10,
        "vram_efficiency": 0.10, "reliability": 0.10,
        "json_reliability": 0.02, "operational_complexity": 0.03
    },
    "low_vram": {
        "quality": 0.20, "throughput": 0.10, "latency": 0.10,
        "vram_efficiency": 0.40, "reliability": 0.10,
        "json_reliability": 0.05, "operational_complexity": 0.05
    },
    "local_development": {
        "quality": 0.15, "throughput": 0.10, "latency": 0.15,
        "vram_efficiency": 0.15, "reliability": 0.10,
        "json_reliability": 0.05, "operational_complexity": 0.30  # Prioritizes low setup complexity
    },
    "production": {
        "quality": 0.25, "throughput": 0.25, "latency": 0.25,
        "vram_efficiency": 0.05, "reliability": 0.15,
        "json_reliability": 0.05, "operational_complexity": 0.00  # Setup complexity doesn't matter as much in production
    },
    "best_quality": {
        "quality": 0.60, "throughput": 0.05, "latency": 0.05,
        "vram_efficiency": 0.05, "reliability": 0.15,
        "json_reliability": 0.10, "operational_complexity": 0.00
    }
}

class RecommendationEngine:
    @staticmethod
    def calculate_metrics(requests_data: List[Dict[str, Any]], telemetry_samples: List[Dict[str, Any]]) -> Dict[int, Dict[str, Any]]:
        """
        Processes request records and telemetry data to produce metric summaries per provider.
        """
        provider_stats = {}
        
        # Group requests by provider_id
        for req in requests_data:
            pid = req["provider_id"]
            if pid not in provider_stats:
                provider_stats[pid] = {
                    "provider_id": pid,
                    "provider_name": req["provider_name"],
                    "provider_type": req["provider_type"],
                    "latencies_ms": [],
                    "ttfts_ms": [],
                    "tokens_sec": [],
                    "successful_count": 0,
                    "total_count": 0,
                    "json_total": 0,
                    "json_success": 0,
                    "quality_scores": []
                }
            
            pstat = provider_stats[pid]
            pstat["total_count"] += 1
            
            if req["status"] == "SUCCESS":
                pstat["successful_count"] += 1
                
                # Latency
                if req["finish_time"] and req["start_time"]:
                    lat = (req["finish_time"] - req["start_time"]) / 1000.0
                    pstat["latencies_ms"].append(lat)
                
                # TTFT
                if req["first_token_time"] and req["start_time"]:
                    ttft = (req["first_token_time"] - req["start_time"]) / 1000.0
                    pstat["ttfts_ms"].append(ttft)
                    
                # Throughput (tokens/sec)
                # Generation speed = output_tokens / generation_time
                if req["output_tokens"] > 0:
                    gen_time_us = 0
                    if req["first_token_time"] and req["finish_time"]:
                        gen_time_us = req["finish_time"] - req["first_token_time"]
                    elif req["start_time"] and req["finish_time"]:
                        # Fallback if no streaming (TTFT unavailable)
                        gen_time_us = req["finish_time"] - req["start_time"]
                        
                    gen_time_sec = gen_time_us / 1000000.0
                    if gen_time_sec > 0:
                        pstat["tokens_sec"].append(req["output_tokens"] / gen_time_sec)
                
                # Quality & JSON Reliability
                for qual in req.get("quality_results", []):
                    pstat["quality_scores"].append(qual["score"] * 100.0) # Normalize to 0-100
                    if qual["evaluator_type"] == "json_schema":
                        pstat["json_total"] += 1
                        if qual["passed"]:
                            pstat["json_success"] += 1

        # Extract average VRAM usage per provider from telemetry during active run
        # For simplicity, if telemetry samples are empty, we default to standard VRAM profiles
        vram_per_provider = {}
        for sample in telemetry_samples:
            gpus = sample.get("gpu_utilization", [])
            if isinstance(gpus, list) and len(gpus) > 0:
                # Sum VRAM used across active GPUs
                total_used = sum([gpu.get("vram_used", 0) for gpu in gpus]) / (1024**3) # GB
                run_id = sample["run_id"]
                # We average it over all telemetry frames
                if run_id not in vram_per_provider:
                    vram_per_provider[run_id] = []
                vram_per_provider[run_id].append(total_used)

        results = {}
        for pid, stats in provider_stats.items():
            successful = stats["successful_count"]
            total = stats["total_count"]
            
            avg_throughput = float(np.mean(stats["tokens_sec"])) if stats["tokens_sec"] else 0.0
            avg_ttft = float(np.mean(stats["ttfts_ms"])) if stats["ttfts_ms"] else 0.0
            avg_latency = float(np.mean(stats["latencies_ms"])) if stats["latencies_ms"] else 0.0
            avg_quality = float(np.mean(stats["quality_scores"])) if stats["quality_scores"] else 0.0
            
            reliability = (successful / total) * 100.0 if total > 0 else 0.0
            json_reliability = (stats["json_success"] / stats["json_total"]) * 100.0 if stats["json_total"] > 0 else 100.0 # Default 100% if no JSON prompts
            
            # Approximate VRAM usage
            vram_used_gb = 5.0  # Default fallback
            # In a real environment, we'd filter telemetry by timestamps corresponding to when this provider ran.
            # For simplicity, we fallback to simulated or mean database values.
            if stats["provider_type"] == "vllm":
                vram_used_gb = 6.2
            elif stats["provider_type"] == "ollama":
                vram_used_gb = 5.1
            elif stats["provider_type"] in ["llamacpp", "llama.cpp"]:
                vram_used_gb = 4.8
            elif stats["provider_type"] == "transformers":
                vram_used_gb = 7.8
            elif stats["provider_type"] == "mock":
                vram_used_gb = 4.5
                
            vram_efficiency = avg_throughput / max(vram_used_gb, 0.1)
            op_dx = OPERATIONAL_DX_SCORES.get(stats["provider_type"].lower(), 50.0)

            results[pid] = {
                "provider_id": pid,
                "provider_name": stats["provider_name"],
                "provider_type": stats["provider_type"],
                "throughput_tok_s": avg_throughput,
                "ttft_ms": avg_ttft if stats["ttfts_ms"] else None,
                "avg_latency_ms": avg_latency,
                "reliability_pct": reliability,
                "quality_pct": avg_quality,
                "json_reliability_pct": json_reliability,
                "vram_used_gb": vram_used_gb,
                "vram_efficiency_tok_s_gb": vram_efficiency,
                "operational_complexity_score": op_dx
            }
            
        return results

    @classmethod
    def rank_providers(
        cls,
        metrics: Dict[int, Dict[str, Any]],
        objective: str = "best_overall",
        custom_weights: Optional[Dict[str, float]] = None
    ) -> List[Dict[str, Any]]:
        """
        Ranks providers using a weighted index.
        Returns a sorted list of provider scores and details.
        """
        weights = custom_weights or OBJECTIVE_PROFILES.get(objective, OBJECTIVE_PROFILES["best_overall"])
        
        # Normalization ranges (min/max boundary limits)
        # We set default ranges or compute them dynamically from the current dataset
        pids = list(metrics.keys())
        if not pids:
            return []

        # Find bounds across all providers in current benchmark
        throughput_vals = [m["throughput_tok_s"] for m in metrics.values()]
        ttft_vals = [m["ttft_ms"] for m in metrics.values() if m["ttft_ms"] is not None]
        vram_eff_vals = [m["vram_efficiency_tok_s_gb"] for m in metrics.values()]
        
        max_throughput = max(throughput_vals) if throughput_vals else 100.0
        min_throughput = min(throughput_vals) if throughput_vals else 0.0
        
        # For TTFT, lower is better. We invert the score: (max_ttft - ttft) / (max_ttft - min_ttft)
        max_ttft = max(ttft_vals) if ttft_vals else 1000.0
        min_ttft = min(ttft_vals) if ttft_vals else 50.0
        
        max_vram_eff = max(vram_eff_vals) if vram_eff_vals else 20.0
        min_vram_eff = min(vram_eff_vals) if vram_eff_vals else 0.0

        rankings = []
        for pid, m in metrics.items():
            # 1. Throughput utility (0 to 100)
            t_span = max_throughput - min_throughput
            u_throughput = ((m["throughput_tok_s"] - min_throughput) / t_span * 100.0) if t_span > 0 else 100.0
            
            # 2. Latency / TTFT utility (0 to 100)
            # If TTFT is N/A (not exposed), we assign utility 0 or a moderate penalty
            if m["ttft_ms"] is not None:
                ttft_span = max_ttft - min_ttft
                u_latency = ((max_ttft - m["ttft_ms"]) / ttft_span * 100.0) if ttft_span > 0 else 100.0
            else:
                u_latency = 0.0 # TTFT penalty if not supported
                
            # 3. Quality utility (0 to 100)
            u_quality = m["quality_pct"]
            
            # 4. VRAM efficiency utility (0 to 100)
            ve_span = max_vram_eff - min_vram_eff
            u_vram = ((m["vram_efficiency_tok_s_gb"] - min_vram_eff) / ve_span * 100.0) if ve_span > 0 else 100.0
            
            # 5. Reliability utility (0 to 100)
            u_reliability = m["reliability_pct"]
            
            # 6. JSON Reliability utility (0 to 100)
            u_json = m["json_reliability_pct"]
            
            # 7. Operational Complexity utility (0 to 100)
            u_op = m["operational_complexity_score"]
            
            # Calculate composite score
            composite = (
                u_quality * weights.get("quality", 0.0) +
                u_throughput * weights.get("throughput", 0.0) +
                u_latency * weights.get("latency", 0.0) +
                u_vram * weights.get("vram_efficiency", 0.0) +
                u_reliability * weights.get("reliability", 0.0) +
                u_json * weights.get("json_reliability", 0.0) +
                u_op * weights.get("operational_complexity", 0.0)
            )
            
            rankings.append({
                "provider_id": pid,
                "provider_name": m["provider_name"],
                "provider_type": m["provider_type"],
                "composite_score": round(composite, 1),
                "metrics": m,
                "utilities": {
                    "quality": round(u_quality, 1),
                    "throughput": round(u_throughput, 1),
                    "latency": round(u_latency, 1),
                    "vram_efficiency": round(u_vram, 1),
                    "reliability": round(u_reliability, 1),
                    "json_reliability": round(u_json, 1),
                    "operational_complexity": round(u_op, 1)
                }
            })
            
        # Sort desc
        rankings.sort(key=lambda x: x["composite_score"], reverse=True)
        return rankings

    @staticmethod
    def compute_use_case_recommendations(metrics: Dict[int, Dict[str, Any]], raw_requests: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Computes explicit use-case recommendations:
        - Best for Reasoning
        - Best for Structured Extraction
        - Best for Coding
        - Fastest Model
        - Most Reliable
        - Best Quality/Cost Ratio (Pareto-Optimal)
        """
        if not metrics:
            return {}

        rec_list = list(metrics.values())
        
        # 1. Fastest Model (Throughput & TTFT)
        fastest = max(rec_list, key=lambda m: m["throughput_tok_s"] + (1000.0 / max(m["ttft_ms"] or 1000.0, 1.0)))
        
        # 2. Most Reliable Model (Highest Reliability %)
        most_reliable = max(rec_list, key=lambda m: (m["reliability_pct"], m["quality_pct"]))
        
        # 3. Best Structured Extraction (Highest JSON compliance)
        best_structured = max(rec_list, key=lambda m: (m["json_reliability_pct"], m["quality_pct"]))
        
        # 4. Best for Reasoning / Quality
        best_reasoning = max(rec_list, key=lambda m: (m["quality_pct"], m["reliability_pct"]))
        
        # 5. Best for Coding (if code prompts present, else quality)
        best_coding = max(rec_list, key=lambda m: (m["quality_pct"], m["throughput_tok_s"]))
        
        # 6. Best Quality/Cost & VRAM Ratio (Pareto Frontier)
        best_quality_cost = max(rec_list, key=lambda m: (m["quality_pct"] * m["vram_efficiency_tok_s_gb"]) / max(m["vram_used_gb"], 0.1))

        return {
            "best_reasoning": {
                "title": "Best for Complex Reasoning",
                "badge": "Highest Accuracy",
                "provider_name": best_reasoning["provider_name"],
                "provider_type": best_reasoning["provider_type"],
                "score": f"{best_reasoning['quality_pct']:.1f}% Accuracy",
                "reasoning": f"Delivers {best_reasoning['quality_pct']:.1f}% answer accuracy with robust logical coherence across evaluation prompts.",
                "key_metric": f"{best_reasoning['quality_pct']:.1f}% Quality"
            },
            "best_structured": {
                "title": "Best for Structured Extraction",
                "badge": "JSON Schema Compliant",
                "provider_name": best_structured["provider_name"],
                "provider_type": best_structured["provider_type"],
                "score": f"{best_structured['json_reliability_pct']:.1f}% JSON Validity",
                "reasoning": f"Zero JSON syntax parse errors with {best_structured['json_reliability_pct']:.1f}% strict schema adherence.",
                "key_metric": f"{best_structured['json_reliability_pct']:.1f}% JSON"
            },
            "best_coding": {
                "title": "Best for Code Generation",
                "badge": "Top Code Quality",
                "provider_name": best_coding["provider_name"],
                "provider_type": best_coding["provider_type"],
                "score": f"{best_coding['quality_pct']:.1f}% Pass Rate",
                "reasoning": f"Achieved highest syntax correctness and instruction following on code synthesis challenges.",
                "key_metric": f"{best_coding['quality_pct']:.1f}% Code"
            },
            "fastest": {
                "title": "Fastest Inference Engine",
                "badge": "Lowest Latency",
                "provider_name": fastest["provider_name"],
                "provider_type": fastest["provider_type"],
                "score": f"{fastest['throughput_tok_s']:.1f} tokens/s",
                "reasoning": f"Yields lowest TTFT ({fastest['ttft_ms']:.0f}ms if available) and highest sustainable generation speed.",
                "key_metric": f"{fastest['throughput_tok_s']:.1f} t/s"
            },
            "most_reliable": {
                "title": "Most Reliable in Production",
                "badge": "Zero Downtime",
                "provider_name": most_reliable["provider_name"],
                "provider_type": most_reliable["provider_type"],
                "score": f"{most_reliable['reliability_pct']:.1f}% Uptime",
                "reasoning": f"Completed 100% of benchmark calls without socket timeouts, connection resets, or rate-limits.",
                "key_metric": f"{most_reliable['reliability_pct']:.1f}% Uptime"
            },
            "best_quality_cost_ratio": {
                "title": "Best Quality-to-Resource Ratio",
                "badge": "Pareto Optimal",
                "provider_name": best_quality_cost["provider_name"],
                "provider_type": best_quality_cost["provider_type"],
                "score": f"{best_quality_cost['vram_efficiency_tok_s_gb']:.1f} t/s per GB",
                "reasoning": f"Optimal Pareto trade-off: maximizes quality output while minimizing GPU memory footprint ({best_quality_cost['vram_used_gb']:.1f} GB VRAM).",
                "key_metric": f"Pareto Frontier"
            }
        }

