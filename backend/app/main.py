import asyncio
import json
from fastapi import FastAPI, Depends, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from typing import List, Dict, Any, Optional

from app.database import engine, Base, get_db
from app import models, schemas, crud
from app.engine.worker import run_executor_worker, queue_run, stop_run, broadcaster
from app.engine.telemetry import TelemetryCollector
from app.engine.recommendation import RecommendationEngine, OBJECTIVE_PROFILES
from app.providers.registry import get_provider_client

# Initialize FastAPI App
app = FastAPI(
    title="LLM Benchmark Lab API",
    description="Backend API for real-time AI/LLM serving runtimes benchmarking and telemetry monitoring.",
    version="1.0.0"
)

# Enable CORS for Next.js frontend calls
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Background tasks lifecycle
worker_task = None
telemetry_task = None


async def run_continuous_telemetry():
    """Background task to continuously poll hardware and store in global DB"""
    while True:
        try:
            stat = hardware_monitor.get_current_stats()
            db = next(get_db())
            
            # insert
            metric = models.SystemMetrics(
                timestamp=int(time.time() * 1_000_000),
                cpu_utilization=stat.cpu_utilization,
                ram_used_bytes=stat.ram_used_bytes,
                ram_total_bytes=stat.ram_total_bytes,
                gpu_utilization=[g.dict() for g in stat.gpus]
            )
            db.add(metric)
            
            # purge older than 7 days
            seven_days_ago = int((time.time() - 7*24*60*60) * 1_000_000)
            db.query(models.SystemMetrics).filter(models.SystemMetrics.timestamp < seven_days_ago).delete()
            
            db.commit()
            db.close()
        except Exception as e:
            print(f"Telemetry daemon error: {e}")
        await asyncio.sleep(5.0)


@app.on_event("startup")
def startup_event():
    global worker_task
    # Create tables
    Base.metadata.create_all(bind=engine)
    
    # Seed database
    db = next(get_db())
    try:
        crud.seed_database(db)
    finally:
        db.close()
        
    # Start background executor loop
    worker_task = asyncio.create_task(run_executor_worker())
    global telemetry_task
    telemetry_task = asyncio.create_task(run_continuous_telemetry())

@app.on_event("shutdown")
def shutdown_event():
    if worker_task:
        worker_task.cancel()
    if telemetry_task:
        telemetry_task.cancel()

# --- PROVIDERS API ---
@app.get("/api/providers", response_model=List[schemas.ProviderResponse])
def get_providers(db: Session = Depends(get_db)):
    return crud.get_providers(db)

@app.post("/api/providers", response_model=schemas.ProviderResponse)
def create_provider(provider: schemas.ProviderCreate, db: Session = Depends(get_db)):
    return crud.create_provider(db, provider)

@app.put("/api/providers/{id}", response_model=schemas.ProviderResponse)
def update_provider(id: int, provider_update: schemas.ProviderUpdate, db: Session = Depends(get_db)):
    db_provider = crud.update_provider(db, id, provider_update)
    if not db_provider:
        raise HTTPException(status_code=404, detail="Provider not found")
    return db_provider

@app.post("/api/providers/{id}/health")
async def test_provider_health(id: int, db: Session = Depends(get_db)):
    prov = db.query(models.Provider).filter(models.Provider.id == id).first()
    if not prov:
        raise HTTPException(status_code=404, detail="Provider not found")
    client = get_provider_client(prov.id, prov.type, prov.name, prov.base_url, prov.api_key)
    res = await client.health_check_detailed()
    online = res["online"]
    models_list = []
    if online:
        models_list = await client.get_models()
        
    prov.last_status = "ONLINE" if online else "OFFLINE"
    prov.last_error = res.get("error")
    import json
    prov.last_models = json.dumps(models_list) if models_list else None
    db.commit()
    
    return {"status": prov.last_status, "models": models_list, "error": prov.last_error}

# --- MODELS API ---
@app.get("/api/models", response_model=List[schemas.ModelResponse])
def get_models(db: Session = Depends(get_db)):
    return crud.get_models(db)

@app.post("/api/models", response_model=schemas.ModelResponse)
def create_model(model: schemas.ModelCreate, db: Session = Depends(get_db)):
    return crud.create_model(db, model)

# --- MODEL DOWNLOADS API ---
@app.post("/api/models/download")
def download_model_endpoint(
    payload: dict,
    db: Session = Depends(get_db)
):
    provider_id = payload.get("provider_id")
    model_name = payload.get("model_name")
    if not provider_id or not model_name:
        raise HTTPException(status_code=400, detail="provider_id and model_name are required.")
    
    prov = db.query(models.Provider).filter(models.Provider.id == provider_id).first()
    if not prov:
        raise HTTPException(status_code=404, detail="Provider not found")
        
    from app.engine.downloader import pull_ollama_model, download_hf_model, active_downloads
    
    if model_name in active_downloads and active_downloads[model_name]["status"] == "downloading":
        return {"status": "already_downloading", "model": model_name, "progress": active_downloads[model_name]["progress"]}
        
    if prov.type == "ollama":
        asyncio.create_task(pull_ollama_model(prov.base_url, model_name))
    elif prov.type == "transformers":
        asyncio.create_task(download_hf_model(model_name))
    else:
        raise HTTPException(
            status_code=400,
            detail=f"Downloading models not supported for provider type '{prov.type}'."
        )
        
    return {"status": "download_started", "model": model_name}

@app.get("/api/models/download")
def get_model_downloads_status():
    from app.engine.downloader import active_downloads
    return active_downloads

# --- PROMPT SUITES API ---
@app.get("/api/prompts", response_model=List[schemas.PromptSuiteResponse])
def get_prompt_suites(db: Session = Depends(get_db)):
    return crud.get_prompt_suites(db)

@app.post("/api/prompts", response_model=schemas.PromptSuiteResponse)
def create_prompt_suite(suite: schemas.PromptSuiteCreate, db: Session = Depends(get_db)):
    return crud.create_prompt_suite(db, suite)

# --- BENCHMARKS / RUNS API ---
@app.get("/api/runs", response_model=List[schemas.BenchmarkRunResponse])
def get_runs(db: Session = Depends(get_db)):
    return crud.get_runs(db)

@app.post("/api/benchmarks", response_model=schemas.BenchmarkRunResponse)
def create_and_queue_benchmark(run: schemas.BenchmarkRunCreate, db: Session = Depends(get_db)):
    db_run = crud.create_benchmark_run(db, run)
    # Queue job asynchronously
    queue_run(db_run.id)
    return db_run

@app.get("/api/runs/{id}", response_model=schemas.BenchmarkRunResponse)
def get_run_details(id: int, db: Session = Depends(get_db)):
    run = crud.get_run(db, id)
    if not run:
        raise HTTPException(status_code=404, detail="Benchmark run not found")
    return run

@app.post("/api/runs/{id}/stop")
def trigger_stop_run(id: int):
    stopped = stop_run(id)
    return {"stopped": stopped}

@app.get("/api/runs/{id}/results", response_model=List[schemas.BenchmarkRequestResponse])
def get_run_results(id: int, db: Session = Depends(get_db)):
    return crud.get_run_requests(db, id)

@app.get("/api/runs/{id}/telemetry", response_model=List[schemas.TelemetrySampleResponse])
def get_run_telemetry(id: int, db: Session = Depends(get_db)):
    return crud.get_run_telemetry(db, id)

# --- HARDWARE API ---
@app.get("/api/hardware")
def get_system_hardware():
    return {
        "static": TelemetryCollector.get_hardware_static_info(),
        "live": TelemetryCollector.collect_all()
    }

# --- COMPARISONS & RECOMMENDATION REPORT API ---
@app.post("/api/comparisons")
def compare_runs(comparison: schemas.ComparisonRequest, db: Session = Depends(get_db)):
    run_ids = comparison.run_ids
    if len(run_ids) < 1:
        raise HTTPException(status_code=400, detail="Provide at least one run ID to analyze.")
    
    # 1. Fetch runs, request logs, and telemetry
    runs = db.query(models.BenchmarkRun).filter(models.BenchmarkRun.id.in_(run_ids)).all()
    if not runs:
        raise HTTPException(status_code=404, detail="No matching runs found.")
        
    flat_requests = []
    telemetry_samples = []
    
    for r in runs:
        # Load request rows
        requests = crud.get_run_requests(db, r.id)
        for req in requests:
            # Flatten slightly for recommendation engine input
            flat_requests.append({
                "run_id": r.id,
                "provider_id": req.provider_id,
                "provider_name": req.provider.name,
                "provider_type": req.provider.type,
                "model_name": req.model_name,
                "status": req.status,
                "start_time": req.start_time,
                "first_token_time": req.first_token_time,
                "finish_time": req.finish_time,
                "prompt_tokens": req.prompt_tokens,
                "output_tokens": req.output_tokens,
                "quality_results": [
                    {"score": qr.score, "evaluator_type": qr.evaluator_type, "passed": qr.passed}
                    for qr in req.quality_results
                ]
            })
            
        # Load telemetry
        samples = crud.get_run_telemetry(db, r.id)
        for s in samples:
            telemetry_samples.append({
                "run_id": r.id,
                "gpu_utilization": s.gpu_utilization
            })

    if not flat_requests:
        return {"comparisons": [], "recommendations": {}}

    # 2. Compute performance metrics
    metrics_summary = RecommendationEngine.calculate_metrics(flat_requests, telemetry_samples)
    
    # 3. Compute rankings across various profiles
    rankings_by_objective = {}
    for obj in OBJECTIVE_PROFILES.keys():
        rankings_by_objective[obj] = RecommendationEngine.rank_providers(metrics_summary, objective=obj)

    # 4. Generate comparison winner summary sentences (explain "Why did this win?")
    why_win_summary = ""
    if rankings_by_objective.get("best_overall"):
        winners = rankings_by_objective["best_overall"]
        if len(winners) > 0:
            top_winner = winners[0]
            w_name = top_winner["provider_name"]
            w_type = top_winner["provider_type"]
            tput = top_winner["metrics"]["throughput_tok_s"]
            lat = top_winner["metrics"]["avg_latency_ms"]
            qual = top_winner["metrics"]["quality_pct"]
            
            why_win_summary = (
                f"{w_name} ({w_type.upper()}) scored the highest composite ranking across prompt categories. "
                f"It achieved a generation throughput of {tput:.1f} tokens/sec, and an average latency of {lat:.0f}ms, "
                f"with an answer validation compliance rate of {qual:.1f}%."
            )
            if len(winners) > 1:
                runner_up = winners[1]
                vram_diff = runner_up["metrics"]["vram_used_gb"] - top_winner["metrics"]["vram_used_gb"]
                if vram_diff > 0:
                    why_win_summary += f" Alternatively, {runner_up['provider_name']} is more memory-efficient, utilizing {vram_diff:.1f} GB less VRAM."

    # Calculate performance metrics per individual run (Task 2.6 Capacity Curves)
    runs_metrics = []
    for r in runs:
        r_requests = [req for req in flat_requests if req["run_id"] == r.id]
        r_telemetry = [s for s in telemetry_samples if s["run_id"] == r.id]
        if r_requests:
            r_summary = RecommendationEngine.calculate_metrics(r_requests, r_telemetry)
            for val in r_summary.values():
                runs_metrics.append({
                    "run_id": r.id,
                    "run_name": r.name,
                    "concurrency": r.config.get("concurrency", 1) if isinstance(r.config, dict) else 1,
                    "provider_name": val["provider_name"],
                    "provider_type": val["provider_type"],
                    "throughput_tok_s": val["throughput_tok_s"],
                    "avg_latency_ms": val["avg_latency_ms"],
                    "ttft_ms": val["ttft_ms"]
                })

    return {
        "metrics": list(metrics_summary.values()),
        "rankings": rankings_by_objective,
        "why_win_summary": why_win_summary,
        "runs_metrics": runs_metrics
    }

@app.get("/api/reports/{run_id}")
def get_run_report(run_id: int, db: Session = Depends(get_db)):
    run = crud.get_run(db, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Benchmark run not found")
        
    # Check if report already exists, else generate one
    db_report = crud.get_run_report(db, run_id)
    if db_report:
        return db_report

    # Generate Report dynamically
    # Load all requirements to generate report data
    requests = crud.get_run_requests(db, run_id)
    telemetry = crud.get_run_telemetry(db, run_id)
    
    flat_requests = []
    for req in requests:
        flat_requests.append({
            "run_id": run_id,
            "provider_id": req.provider_id,
            "provider_name": req.provider.name,
            "provider_type": req.provider.type,
            "model_name": req.model_name,
            "status": req.status,
            "start_time": req.start_time,
            "first_token_time": req.first_token_time,
            "finish_time": req.finish_time,
            "prompt_tokens": req.prompt_tokens,
            "output_tokens": req.output_tokens,
            "quality_results": [
                {"score": qr.score, "evaluator_type": qr.evaluator_type, "passed": qr.passed}
                for qr in req.quality_results
            ]
        })
        
    flat_telemetry = [{"run_id": run_id, "gpu_utilization": s.gpu_utilization} for s in telemetry]
    
    metrics_summary = RecommendationEngine.calculate_metrics(flat_requests, flat_telemetry)
    
    # Compute profiles
    recommendations = {}
    for obj in OBJECTIVE_PROFILES.keys():
        recommendations[obj] = RecommendationEngine.rank_providers(metrics_summary, objective=obj)
        
    # Create executive summary text
    exec_summary = f"Benchmark Lab analysis completed for execution '{run.name}'. "
    if recommendations.get("best_overall"):
        best = recommendations["best_overall"][0]
        exec_summary += f"The recommendation engine identified {best['provider_name']} as the optimal configuration under balanced weights (Score: {best['composite_score']}/100)."
        
    report = models.Report(
        run_id=run_id,
        summary=exec_summary,
        recommendations={"metrics": list(metrics_summary.values()), "rankings": recommendations}
    )
    db.add(report)
    db.commit()
    db.refresh(report)
    return report

# --- EXPORTS API ---
@app.get("/api/runs/{run_id}/export")
def export_run_report(run_id: int, format: str = "html", db: Session = Depends(get_db)):
    run = crud.get_run(db, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Benchmark run not found")
        
    requests = crud.get_run_requests(db, run_id)
    telemetry = crud.get_run_telemetry(db, run_id)
    
    # Calculate verdict from RecommendationEngine
    flat_requests = []
    for req in requests:
        flat_requests.append({
            "run_id": run_id,
            "provider_id": req.provider_id,
            "provider_name": req.provider.name,
            "provider_type": req.provider.type,
            "model_name": req.model_name,
            "status": req.status,
            "start_time": req.start_time,
            "first_token_time": req.first_token_time,
            "finish_time": req.finish_time,
            "prompt_tokens": req.prompt_tokens,
            "output_tokens": req.output_tokens,
            "quality_results": [
                {"score": qr.score, "evaluator_type": qr.evaluator_type, "passed": qr.passed}
                for qr in req.quality_results
            ]
        })
        
    flat_telemetry = [{"run_id": run_id, "gpu_utilization": s.gpu_utilization} for s in telemetry]
    metrics_summary = RecommendationEngine.calculate_metrics(flat_requests, flat_telemetry)
    rankings = RecommendationEngine.rank_providers(metrics_summary, objective="best_overall")
    
    verdict = ""
    if rankings:
        best = rankings[0]
        verdict = (
            f"Winner: {best['provider_name']} ({best['provider_type'].upper()}) with balanced score: {best['composite_score']}/100. "
            f"It reached {best['metrics']['throughput_tok_s']:.1f} tok/s and TTFT of {best['metrics']['ttft_ms']:.0f}ms."
        )

    if format == "html" or format == "pdf":
        from app.engine.report_generator import generate_html_report
        from fastapi.responses import HTMLResponse
        
        html_content = generate_html_report(run, requests, telemetry, verdict)
        return HTMLResponse(
            content=html_content,
            headers={
                "Content-Disposition": f"attachment; filename=benchmark_run_{run_id}_report.html"
            }
        )
    elif format == "csv":
        import csv
        import io
        from fastapi.responses import StreamingResponse
        
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["Request ID", "Provider", "Model", "TTFT (ms)", "Latency (ms)", "Tokens/sec", "Score"])
        
        for req in requests:
            speed = req.output_tokens / (req.total_time_ms / 1000.0) if not req.error and req.total_time_ms > 0 else 0.0
            score = req.score if req.score is not None else 1.0
            writer.writerow([req.id, req.provider.name, req.model_name, req.ttft_ms or "N/A", req.total_time_ms, round(speed, 2), score])
            
        output.seek(0)
        return StreamingResponse(
            io.BytesIO(output.getvalue().encode("utf-8")),
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename=benchmark_run_{run_id}_results.csv"}
        )
    else:
        return {
            "run_id": run_id,
            "metrics": list(metrics_summary.values()),
            "rankings": rankings
        }

# --- LIVE TELEMETRY SSE STREAM ---
@app.get("/api/events")
async def get_live_events_stream():
    """
    Server-Sent Events endpoint streaming live telemetry and progress metrics.
    Connected frontend applications subscribe to this route.
    """
    async def event_generator():
        q = broadcaster.subscribe()
        try:
            while True:
                # Wait for next event
                event_data = await q.get()
                event_name = event_data["event"]
                payload = event_data["data"]
                
                # Format SSE output
                yield f"event: {event_name}\ndata: {json.dumps(payload)}\n\n"
                q.task_done()
        except asyncio.CancelledError:
            pass
        finally:
            broadcaster.unsubscribe(q)

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@app.get("/api/telemetry/history")
def get_telemetry_history(range_min: int = 60, db: Session = Depends(get_db)):
    # range_min is minutes (e.g. 15, 60, 1440=24h, 10080=7d)
    threshold = int((time.time() - range_min * 60) * 1_000_000)
    
    # We don't want to send 100,000 records if they select 7 days.
    # Downsample if needed, but for now just pull and let DB filter
    metrics = db.query(models.SystemMetrics).filter(models.SystemMetrics.timestamp >= threshold).order_by(models.SystemMetrics.timestamp.asc()).all()
    
    # If there are > 500 records, we can downsample them linearly
    res = []
    step = max(1, len(metrics) // 200) # max 200 data points for UI graph
    
    for i in range(0, len(metrics), step):
        m = metrics[i]
        res.append({
            "timestamp": m.timestamp,
            "cpu_utilization": m.cpu_utilization,
            "ram_used_bytes": m.ram_used_bytes,
            "ram_total_bytes": m.ram_total_bytes,
            "gpu_utilization": m.gpu_utilization
        })
        
    return res



@app.get("/api/requests")
def get_global_requests(limit: int = 100, offset: int = 0, db: Session = Depends(get_db)):
    reqs = db.query(models.BenchmarkRequest).order_by(models.BenchmarkRequest.created_at.desc()).offset(offset).limit(limit).all()
    
    res = []
    for r in reqs:
        # Avoid huge response text in list view
        res.append({
            "id": r.id,
            "run_id": r.run_id,
            "run_name": r.run.name if r.run else "Unknown",
            "provider_name": r.provider.name if r.provider else "Unknown",
            "model_name": r.model_name,
            "status": r.status,
            "prompt_tokens": r.prompt_tokens,
            "output_tokens": r.output_tokens,
            "total_tokens": r.total_tokens,
            "created_at": r.created_at.isoformat() if r.created_at else None,
            "start_time": r.start_time,
            "finish_time": r.finish_time,
            "latency_ms": ((r.finish_time - r.start_time) / 1000) if r.finish_time and r.start_time else None
        })
    return res

@app.get("/api/requests/{req_id}")
def get_global_request_detail(req_id: int, db: Session = Depends(get_db)):
    r = db.query(models.BenchmarkRequest).filter(models.BenchmarkRequest.id == req_id).first()
    if not r: raise HTTPException(status_code=404)
    return {
        "id": r.id,
        "run_name": r.run.name if r.run else "Unknown",
        "provider_name": r.provider.name if r.provider else "Unknown",
        "model_name": r.model_name,
        "status": r.status,
        "response_text": r.response_text,
        "error_message": r.error_message,
        "prompt_text": r.prompt.prompt if r.prompt else None,
        "system_prompt": r.prompt.system_prompt if r.prompt else None
    }


@app.get("/api/logs")
def get_system_logs(limit: int = 200, db: Session = Depends(get_db)):
    logs = db.query(models.SystemEventLog).order_by(models.SystemEventLog.timestamp.desc()).limit(limit).all()
    return [{"id": l.id, "timestamp": l.timestamp, "level": l.level, "source": l.source, "message": l.message} for l in logs]
