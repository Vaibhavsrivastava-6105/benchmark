import asyncio
import time
import logging
from typing import List, Dict, Any, Optional, Callable
from sqlalchemy.orm import Session
from app.models import BenchmarkRun, BenchmarkRequest, Provider, Prompt, QualityResult, TelemetrySample
from app.providers.registry import get_provider_client
from app.engine.evaluator import ResponseEvaluator

logger = logging.getLogger(__name__)

class BenchmarkRunner:
    def __init__(
        self,
        db: Session,
        run_id: int,
        event_callback: Optional[Callable[[str, Dict[str, Any]], None]] = None
    ):
        self.db = db
        self.run_id = run_id
        self.event_callback = event_callback
        self.stop_requested = False

    def trigger_event(self, event_type: str, data: Dict[str, Any]):
        if self.event_callback:
            self.event_callback(event_type, {**data, "run_id": self.run_id})

    async def execute(self):
        """
        Executes the benchmarking session based on its database configuration.
        """
        # Load run config
        run = self.db.query(BenchmarkRun).filter(BenchmarkRun.id == self.run_id).first()
        if not run:
            logger.error(f"Run ID {self.run_id} not found in database.")
            return

        config = run.config
        model_name = config.model.name
        
        self.trigger_event("benchmark_started", {"status": "RUNNING"})
        run.status = "RUNNING"
        run.started_at = datetime_now()
        self.db.commit()

        # Load prompts & providers linked to this run configuration
        # For our MVP/database schema, we retrieve the linked prompt suites and providers.
        # We can dynamically store which providers/suites are selected in BenchmarkRun metadata
        # or load them. Let's make sure we retrieve them.
        # For simplicity, we store selected provider IDs and prompt suite IDs inside BenchmarkRun config/meta.
        # Let's extract them from hardware_info or metadata or create a mapping table.
        # Since we put provider_ids & prompt_suite_ids in the BenchmarkRunCreate schema, we can look up 
        # which providers and prompts are active. Let's pass them dynamically or read them from database.
        # To support direct database queries, we can store selected lists in run.hardware_info JSON under "configs".
        meta = run.hardware_info or {}
        model_names = meta.get("model_names", ["Unknown"])
        targets = meta.get("targets")
        judge_model = meta.get("llm_judge_model_name")
        provider_ids = meta.get("provider_ids", [])
        suite_ids = meta.get("prompt_suite_ids", [])
        benchmark_mode = meta.get("benchmark_mode", "standard")
        exact_match_keyword = meta.get("exact_match_keyword")
        
        providers = self.db.query(Provider).filter(Provider.id.in_(provider_ids), Provider.enabled == True).all()
        prompts = self.db.query(Prompt).filter(Prompt.suite_id.in_(suite_ids)).all()

        if not providers:
            run.status = "FAILED"
            run.error_message = "No active providers selected for benchmarking."
            run.completed_at = datetime_now()
            self.db.commit()
            self.trigger_event("benchmark_completed", {"status": "FAILED", "error": run.error_message})
            return

        if not prompts:
            run.status = "FAILED"
            run.error_message = "No prompts found in the selected prompt suites."
            run.completed_at = datetime_now()
            self.db.commit()
            self.trigger_event("benchmark_completed", {"status": "FAILED", "error": run.error_message})
            return

        # Initialize Judge Provider if specified
        judge_provider = None
        
        judge_provider_id = meta.get("llm_judge_provider_id")
        if judge_provider_id and judge_model:
            j_prov = self.db.query(Provider).filter(Provider.id == judge_provider_id).first()
            if j_prov:
                judge_provider = get_provider_client(
                    j_prov.id, j_prov.type, j_prov.name, j_prov.base_url, j_prov.api_key
                )

                # PRE-FLIGHT CHECK: Auto-start offline providers based on targets
        import asyncio
        from app.engine.process_manager import start_provider_with_model
        started_any = False
        if targets and len(targets) > 0:
            provider_map = {p.id: p for p in providers}
            for t in targets:
                prov_id = t.get("provider_id")
                mn = t.get("model_name")
                p = provider_map.get(prov_id)
                if p:
                    c = get_provider_client(p.id, p.type, p.name, p.base_url, p.api_key)
                    health = await c.health_check_detailed()
                    if not health["online"]:
                        self.trigger_event("info", {"message": f"Auto-starting {p.name} for {mn}..."})
                        start_provider_with_model(p.type, mn, p.base_url)
                        started_any = True
        else:
            for mn in model_names:
                for p in providers:
                    c = get_provider_client(p.id, p.type, p.name, p.base_url, p.api_key)
                    health = await c.health_check_detailed()
                    if not health["online"]:
                        self.trigger_event("info", {"message": f"Auto-starting {p.name} for {mn}..."})
                        start_provider_with_model(p.type, mn, p.base_url)
                        started_any = True
        
        if started_any:
            self.trigger_event("info", {"message": "Waiting 8 seconds for offline servers to boot..."})
            await asyncio.sleep(8)

        # 1. Warmup Requests (Execute concurrently or sequentially per provider/model)
        if config.warmup_requests > 0:
            self.trigger_event("warmup_started", {"count": config.warmup_requests})
            await self._run_warmups(providers, model_name, config)
            self.trigger_event("warmup_completed", {})

        # Prepare request queue
        # Each request is: provider x prompt x repetition (or target x prompt x repetition)
        request_queue = []
        req_index = 0
        for repetition in range(config.repetitions):
            for prompt in prompts:
                if targets:
                    for t in targets:
                        provider = next((p for p in providers if p.id == t.get("provider_id")), None)
                        if provider:
                            request_queue.append({
                                "provider": provider,
                                "prompt": prompt,
                                "model_name": t.get("model_name", model_name),
                                "repetition": repetition,
                                "index": req_index
                            })
                            req_index += 1
                else:
                    for provider in providers:
                        request_queue.append({
                            "provider": provider,
                            "prompt": prompt,
                            "model_name": model_name,
                            "repetition": repetition,
                            "index": req_index
                        })
                        req_index += 1

        run.total_requests = len(request_queue)
        self.db.commit()

        # Concurrency Semaphores
        concurrency_limit = config.concurrency or 1
        provider_semaphores = {}
        for p in providers:
            p_limit = concurrency_limit
            if p.max_concurrency and p.max_concurrency > 0:
                p_limit = min(concurrency_limit, p.max_concurrency)
            provider_semaphores[p.id] = asyncio.Semaphore(p_limit)
        
        # Request rate limiter (seconds to sleep between request dispatches)
        rate_delay = None
        if config.request_rate and config.request_rate > 0:
            rate_delay = 1.0 / config.request_rate

        start_time_s = time.time()
        completed_count = 0
        failed_count = 0

        async def run_single(item):
            nonlocal completed_count, failed_count
            if self.stop_requested:
                return

            provider = item["provider"]
            prompt = item["prompt"]
            repetition = item["repetition"]
            idx = item["index"]
            item_model_name = item.get("model_name", model_name)

            # Create request record
            db_req = BenchmarkRequest(
                run_id=self.run_id,
                provider_id=provider.id,
                model_name=item_model_name,
                prompt_id=prompt.id,
                request_index=idx,
                repetition_index=repetition,
                concurrency_index=concurrency_limit,
                status="RUNNING",
                start_time=time.time_ns() // 1000
            )
            self.db.add(db_req)
            self.db.commit()
            
            self.trigger_event("request_started", {"request_index": idx, "provider": provider.name})

            async with provider_semaphores[provider.id]:
                # If pacing is enabled, delay slightly
                if rate_delay:
                    await asyncio.sleep(rate_delay)

                try:
                    # Instantiate provider client
                    client = get_provider_client(
                        provider.id, provider.type, provider.name, provider.base_url, provider.api_key
                    )
                    
                    gen_options = {
                        "temperature": config.temperature,
                        "top_p": config.top_p,
                        "top_k": config.top_k,
                        "seed": config.seed,
                        "max_tokens": config.max_tokens,
                        "stop_sequences": config.stop_sequences
                    }

                    # Execute stream generation to capture TTFT
                    text = ""
                    ttft_ms = None
                    first_token_time = None
                    prompt_tokens = 0
                    output_tokens = 0
                    token_count_source = "unknown"
                    error = None
                    finish_time = None
                    
                    # Override options based on benchmark mode
                    mode_prompt = prompt.prompt
                    mode_sys = prompt.system_prompt
                    mode_schema = prompt.schema_definition
                    evaluator_type = prompt.evaluator
                    expected_answer = prompt.expected_answer
                    
                    if benchmark_mode == "structured_json":
                        evaluator_type = "json_schema"
                        gen_options["response_format"] = {"type": "json_object"}
                        # Inject a basic schema to parse if one wasn't provided
                        if not mode_schema:
                            mode_schema = {"type": "object"}
                        # Some providers require 'json' string in prompt to work with json mode
                        if "json" not in mode_prompt.lower() and "json" not in (mode_sys or "").lower():
                            mode_sys = f"{mode_sys or ''}\n\nYou must output ONLY valid JSON format."
                    elif benchmark_mode == "exact_match":
                        evaluator_type = "exact_match"
                        expected_answer = exact_match_keyword or expected_answer
                    elif benchmark_mode == "llm_judge":
                        evaluator_type = "llm_judge"

                    async def process_stream():
                        nonlocal error, ttft_ms, first_token_time, text, prompt_tokens, output_tokens, token_count_source, finish_time
                        async for chunk in client.generate_stream(item_model_name, mode_prompt, mode_sys, gen_options):
                            if self.stop_requested:
                                break
                            if "error" in chunk:
                                error = chunk["error"]
                                break
                            
                            if chunk.get("is_first"):
                                ttft_ms = chunk.get("ttft_ms")
                                first_token_time = chunk.get("first_token_time")
                                self.trigger_event("first_token", {"request_index": idx, "ttft_ms": ttft_ms})
                            
                            if chunk.get("is_done"):
                                text = chunk.get("text", "")
                                prompt_tokens = chunk.get("prompt_tokens", 0)
                                output_tokens = chunk.get("output_tokens", 0)
                                token_count_source = chunk.get("token_count_source", "estimated")
                                finish_time = chunk.get("finish_time")
                                
                    try:
                        # 300 second absolute timeout per prompt
                        await asyncio.wait_for(process_stream(), timeout=300.0)
                    except asyncio.TimeoutError:
                        error = "Request timed out after 300 seconds."

                            
                    if error:
                        raise Exception(error)

                    if self.stop_requested:
                        db_req.status = "FAILED"
                        db_req.error_message = "Benchmark manually stopped."
                        self.db.commit()
                        return

                    # Update database request record
                    db_req.status = "SUCCESS"
                    db_req.response_text = text
                    db_req.first_token_time = first_token_time
                    db_req.finish_time = finish_time
                    db_req.prompt_tokens = prompt_tokens
                    db_req.output_tokens = output_tokens
                    db_req.total_tokens = prompt_tokens + output_tokens
                    db_req.token_count_source = token_count_source
                    db_req.http_status = 200
                    
                    # Execute Quality Evaluation
                    score, passed, details = ResponseEvaluator.evaluate(
                        evaluator_type, text, expected_answer, mode_schema
                    )
                    
                    eval_res = QualityResult(
                        request_id=db_req.id,
                        evaluator_type=prompt.evaluator,
                        score=score,
                        passed=passed,
                        details=details
                    )
                    self.db.add(eval_res)

                    # LLM Judge Evaluation (optional, non-blocking / sequential evaluation)
                    if judge_provider and judge_model:
                        j_score, j_passed, j_details = await ResponseEvaluator.evaluate_llm_judge(
                            text, prompt.prompt, prompt.expected_answer, judge_provider, judge_model
                        )
                        judge_res = QualityResult(
                            request_id=db_req.id,
                            evaluator_type="llm_judge",
                            score=j_score,
                            passed=j_passed,
                            details=j_details
                        )
                        self.db.add(judge_res)

                    completed_count += 1
                    self.db.commit()
                    
                    self.trigger_event("request_completed", {
                        "request_index": idx,
                        "provider": provider.name,
                        "latency_ms": (finish_time - db_req.start_time) / 1000.0,
                        "ttft_ms": ttft_ms,
                        "tokens_per_sec": output_tokens / ((finish_time - (first_token_time or db_req.start_time)) / 1000000.0) if output_tokens > 0 else 0.0
                    })

                except Exception as ex:
                    logger.exception(f"Request {idx} failed:")
                    failed_count += 1
                    db_req.status = "FAILED"
                    db_req.error_message = str(ex)
                    db_req.finish_time = time.time_ns() // 1000
                    self.db.commit()
                    self.trigger_event("request_failed", {"request_index": idx, "provider": provider.name, "error": str(ex)})

                # Update main run progress
                run.completed_requests = completed_count
                run.failed_requests = failed_count
                self.db.commit()

        is_sequential = meta.get("sequential_execution", True)

        if is_sequential:
            # Batch execution sequentially by provider to conserve VRAM/compute
            for provider in providers:
                # Process all requests for this specific provider before moving to the next
                provider_queue = [item for item in request_queue if item["provider"].id == provider.id]
                tasks = [run_single(item) for item in provider_queue]
                
                # Gather only this provider's tasks
                await asyncio.gather(*tasks)
                
                # Force Python Garbage Collection (helps clear Transformers PyTorch VRAM)
                import gc
                import torch
                gc.collect()
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
        else:
            # Batch execution using gather with concurrency limits for all at once
            tasks = [run_single(item) for item in request_queue]
            await asyncio.gather(*tasks)

        # Mark Run completion
        end_time_s = time.time()
        run.completed_at = datetime_now()
        run.duration_seconds = end_time_s - start_time_s
        
        # Calculate statistical aggregates (Percentiles & Standard Deviations)
        from app.engine.evaluator import calculate_percentiles, evaluate_consistency, calculate_cost_and_energy
        
        reqs = self.db.query(BenchmarkRequest).filter(BenchmarkRequest.run_id == run.id).all()
        valid_ttfts = []
        valid_latencies = []
        valid_tpots = []
        total_prompt_tokens = 0
        total_output_tokens = 0
        
        prompt_responses_map = {} # prompt_id -> list of responses for consistency check

        for r in reqs:
            if r.status == "SUCCESS":
                total_prompt_tokens += (r.prompt_tokens or 0)
                total_output_tokens += (r.output_tokens or 0)
                
                if r.first_token_time and r.start_time:
                    ttft = (r.first_token_time - r.start_time) / 1000.0
                    valid_ttfts.append(ttft)
                if r.finish_time and r.start_time:
                    lat = (r.finish_time - r.start_time) / 1000.0
                    valid_latencies.append(lat)
                if r.finish_time and r.first_token_time and r.output_tokens and r.output_tokens > 1:
                    tpot = (r.finish_time - r.first_token_time) / 1000.0 / (r.output_tokens - 1)
                    valid_tpots.append(tpot)
                
                if r.prompt_id and r.response_text:
                    prompt_responses_map.setdefault(r.prompt_id, []).append(r.response_text)
        
        # Percentiles & Std Dev
        if valid_ttfts:
            ttft_stats = calculate_percentiles(valid_ttfts)
            run.mean_ttft_ms = ttft_stats["mean"]
            run.std_dev_ttft_ms = ttft_stats["std_dev"]
        if valid_latencies:
            lat_stats = calculate_percentiles(valid_latencies)
            run.std_dev_latency_ms = lat_stats["std_dev"]
            run.p50_latency_ms = lat_stats["p50"]
            run.p90_latency_ms = lat_stats["p90"]
            run.p95_latency_ms = lat_stats["p95"]
            run.p99_latency_ms = lat_stats["p99"]
        if valid_tpots:
            run.mean_tpot_ms = sum(valid_tpots) / len(valid_tpots)
            
        # Quality Aggregates
        qualities = self.db.query(QualityResult).join(BenchmarkRequest).filter(BenchmarkRequest.run_id == run.id).all()
        if qualities:
            json_evals = [q for q in qualities if q.evaluator_type == "json_schema"]
            acc_evals = [q for q in qualities if q.evaluator_type not in ["json_schema", "llm_judge", "instruction_following", "reasoning_quality", "hallucination_detector"]]
            inst_evals = [q for q in qualities if q.evaluator_type == "instruction_following"]
            reas_evals = [q for q in qualities if q.evaluator_type == "reasoning_quality"]
            hall_evals = [q for q in qualities if q.evaluator_type == "hallucination_detector"]
            judge_evals = [q for q in qualities if q.evaluator_type == "llm_judge"]
            
            if json_evals:
                run.json_success_rate = sum(1 for q in json_evals if q.passed) / len(json_evals) * 100.0
            if acc_evals:
                run.accuracy_score = sum(q.score for q in acc_evals) / len(acc_evals) * 100.0
            if inst_evals:
                run.instruction_following_rate = sum(q.score for q in inst_evals) / len(inst_evals) * 100.0
            if reas_evals:
                run.reasoning_score = sum(q.score for q in reas_evals) / len(reas_evals) * 100.0
            if hall_evals:
                run.hallucination_rate = sum(1 for q in hall_evals if not q.passed) / len(hall_evals) * 100.0
            if judge_evals:
                run.llm_judge_score = sum(q.score for q in judge_evals) / len(judge_evals) * 100.0

        # Consistency Evaluation across repetitions
        consistency_scores = []
        for p_id, responses in prompt_responses_map.items():
            if len(responses) >= 2:
                c_score, _ = evaluate_consistency(responses)
                consistency_scores.append(c_score)
        if consistency_scores:
            run.consistency_score = round((sum(consistency_scores) / len(consistency_scores)) * 100.0, 2)
        else:
            run.consistency_score = 100.0

        # Financial Cost & Energy Consumption Analysis
        telemetry_samples = self.db.query(TelemetrySample).filter(TelemetrySample.run_id == run.id).all()
        cost_stats = calculate_cost_and_energy(
            prompt_tokens=total_prompt_tokens,
            output_tokens=total_output_tokens,
            duration_seconds=run.duration_seconds,
            telemetry_samples=telemetry_samples,
            cost_input_per_1k=getattr(config.model, "cost_input_per_1k", 0.0) if config.model else 0.0,
            cost_output_per_1k=getattr(config.model, "cost_output_per_1k", 0.0) if config.model else 0.0,
            electricity_cost_kwh=getattr(config, "local_electricity_cost_kwh", 0.12)
        )
        run.total_cost_usd = cost_stats["total_cost_usd"]
        run.cost_per_1k_tokens = cost_stats["cost_per_1k_tokens"]
        run.cost_per_1m_tokens = cost_stats["cost_per_1m_tokens"]
        run.energy_consumption_kwh = cost_stats["energy_consumption_kwh"]
        run.energy_cost_usd = cost_stats["energy_cost_usd"]

        # Immutable snapshots of datasets & models
        run.dataset_snapshot = [
            {"suite_id": p.suite_id, "prompt_id": p.id, "category": p.category, "version": getattr(p, "version", "1.0.0")}
            for p in prompts
        ]
        run.model_snapshot = [
            {"provider_id": item["provider"].id, "provider_name": item["provider"].name, "model": item["model_name"]}
            for item in request_queue[:len(providers)]
        ]

        if self.stop_requested:
            run.status = "STOPPED"
        elif failed_count == len(request_queue):
            run.status = "FAILED"
            run.error_message = "All benchmarking requests failed."
        else:
            run.status = "COMPLETED"
            
        self.db.commit()
        self.trigger_event("benchmark_completed", {"status": run.status})

    async def _run_warmups(self, providers: List[Provider], model_name: str, config: Any):
        """
        Executes warmup requests to ensure runtimes have loaded model weights.
        """
        for provider in providers:
            client = get_provider_client(
                provider.id, provider.type, provider.name, provider.base_url, provider.api_key
            )
            for _ in range(config.warmup_requests):
                if self.stop_requested:
                    return
                try:
                    await client.generate(
                        model=model_name,
                        prompt="Warmup request. Repeat after me: hello.",
                        system_prompt="You are a warm-up tester.",
                        options={"temperature": 0.0, "max_tokens": 10}
                    )
                except Exception:
                    pass

def datetime_now():
    return datetime.datetime.utcnow()

import datetime
