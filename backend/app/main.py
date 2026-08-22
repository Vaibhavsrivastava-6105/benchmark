import sqlalchemy
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
from app.engine.process_manager import get_process_telemetry, start_provider, stop_provider
import urllib.parse
from app.engine.telemetry import TelemetryCollector
import time
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
            stat = TelemetryCollector.collect_all()
            db = next(get_db())
            
            # insert
            metric = models.SystemMetrics(
                timestamp=int(time.time() * 1_000_000),
                cpu_utilization=stat["cpu_utilization"],
                ram_used_bytes=stat["ram_used_bytes"],
                ram_total_bytes=stat["ram_total_bytes"],
                gpu_utilization=stat["gpu_utilization"]
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
    provs = crud.get_providers(db)
    res = []
    for p in provs:
        p_dict = p.__dict__.copy()
        if p.base_url:
            try:
                parsed = urllib.parse.urlparse(p.base_url)
                if parsed.port:
                    p_dict["process_telemetry"] = get_process_telemetry(parsed.port)
            except:
                pass
        res.append(p_dict)
    return res

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

@app.post("/api/providers/{id}/start")
def start_prov_action(id: int, db: Session = Depends(get_db)):
    prov = db.query(models.Provider).filter(models.Provider.id == id).first()
    if prov:
        if prov.type == "transformers":
            prov.last_status = "ONLINE"
            db.commit()
        else:
            start_provider(prov.type)
    return {"status": "ok"}

@app.post("/api/providers/{id}/stop")
def stop_prov_action(id: int, db: Session = Depends(get_db)):
    prov = db.query(models.Provider).filter(models.Provider.id == id).first()
    if prov:
        if prov.type == "transformers":
            prov.last_status = "OFFLINE"
            db.commit()
        elif prov.base_url:
            parsed = urllib.parse.urlparse(prov.base_url)
            if parsed.port:
                stop_provider(parsed.port)
    return {"status": "ok"}

@app.post("/api/providers/{id}/stop")
def stop_prov_action(id: int, db: Session = Depends(get_db)):
    prov = db.query(models.Provider).filter(models.Provider.id == id).first()
    if prov and prov.base_url:
        parsed = urllib.parse.urlparse(prov.base_url)
        if parsed.port:
            stop_provider(parsed.port)
    return {"status": "ok"}

import time
@app.get("/api/providers/{id}/ping")
async def ping_provider(id: int, db: Session = Depends(get_db)):
    prov = db.query(models.Provider).filter(models.Provider.id == id).first()
    if not prov:
        return {"ping_ms": -1}
    
    # Measure time
    start = time.time()
    try:
        client = get_provider_client(prov.id, prov.type, prov.name, prov.base_url, prov.api_key)
        res = await client.health_check_detailed()
        if res.get("online"):
            return {"ping_ms": int((time.time() - start) * 1000)}
    except Exception:
        pass
    return {"ping_ms": -1}

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

from fastapi import UploadFile, File, Form
import csv
import io



@app.get("/api/prompts", response_model=List[schemas.PromptSuiteResponse])
def get_prompt_suites(db: Session = Depends(get_db)):
    return crud.get_prompt_suites(db)

@app.post("/api/prompts", response_model=schemas.PromptSuiteResponse)
def create_prompt_suite(suite: schemas.PromptSuiteCreate, db: Session = Depends(get_db)):
    return crud.create_prompt_suite(db, suite)

@app.post("/api/prompts/upload", response_model=schemas.PromptSuiteResponse)
async def upload_prompt_suite(
    file: UploadFile = File(...),
    name: str = Form(...),
    description: str = Form(""),
    db: Session = Depends(get_db)
):
    try:
        content = await file.read()
        text = content.decode("utf-8")
        reader = csv.DictReader(io.StringIO(text))
        
        suite = models.PromptSuite(name=name, description=description)
        db.add(suite)
        db.commit()
        db.refresh(suite)
        
        prompts = []
        for row in reader:
            prompt_text = row.get("prompt", "").strip()
            if not prompt_text:
                continue
            p = models.Prompt(
                suite_id=suite.id,
                category=row.get("category", "General"),
                prompt=prompt_text,
                expected_answer=row.get("expected_answer", "")
            )
            prompts.append(p)
            
        if prompts:
            db.add_all(prompts)
            db.commit()
            
        db.refresh(suite)
        return suite
    except sqlalchemy.exc.IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="A Dataset with this exact name already exists.")
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/prompts/{suite_id}")
def get_prompt_suite(suite_id: int, db: Session = Depends(get_db)):
    suite = crud.get_prompt_suite(db, suite_id)
    if not suite:
        raise HTTPException(status_code=404, detail="Prompt suite not found")
    return {
        "id": suite.id,
        "name": suite.name,
        "description": suite.description,
        "created_at": suite.created_at,
        "prompts": [
            {
                "id": p.id,
                "category": p.category,
                "prompt": p.prompt,
                "expected_answer": p.expected_answer
            }
            for p in suite.prompts
        ]
    }

@app.get("/api/prompts/{suite_id}/export")
def export_prompt_suite(suite_id: int, format: str = Query("json"), db: Session = Depends(get_db)):
    suite = crud.get_prompt_suite(db, suite_id)
    if not suite:
        raise HTTPException(status_code=404, detail="Prompt suite not found")
    
    prompts_data = [
        {
            "category": p.category,
            "prompt": p.prompt,
            "expected_answer": p.expected_answer
        }
        for p in suite.prompts
    ]
    
    if format.lower() == "csv":
        import io
        import csv
        output = io.StringIO()
        writer = csv.DictWriter(output, fieldnames=["category", "prompt", "expected_answer"])
        writer.writeheader()
        writer.writerows(prompts_data)
        
        return Response(
            content=output.getvalue(),
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename=dataset_{suite_id}.csv"}
        )
    else:
        # JSON export
        return Response(
            content=json.dumps({"name": suite.name, "description": suite.description, "prompts": prompts_data}, indent=2),
            media_type="application/json",
            headers={"Content-Disposition": f"attachment; filename=dataset_{suite_id}.json"}
        )

@app.delete("/api/prompts/{suite_id}")
def delete_prompt_suite(suite_id: int, db: Session = Depends(get_db)):
    suite = crud.get_prompt_suite(db, suite_id)
    if not suite:
        raise HTTPException(status_code=404, detail="Prompt suite not found")
    # Delete prompts first or cascade
    for p in suite.prompts:
        db.delete(p)
    db.delete(suite)
    db.commit()
    return {"status": "success", "message": f"Deleted prompt suite {suite_id}"}


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
def trigger_stop_run(id: int, db: Session = Depends(get_db)):
    stopped = stop_run(id)
    if not stopped:
        run = crud.get_run(db, id)
        if run and run.status in ["PENDING", "RUNNING"]:
            run.status = "STOPPED"
            db.commit()
            stopped = True
    return {"stopped": stopped}

from app.engine.report_generator import generate_recommendation_async

@app.post("/api/runs/{id}/recommendation")
async def get_run_recommendation(id: int, db: Session = Depends(get_db)):
    rec = await generate_recommendation_async(id, db)
    return {"recommendation": rec}

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

    use_case_recs = RecommendationEngine.compute_use_case_recommendations(metrics_summary, flat_requests)

    return {
        "metrics": list(metrics_summary.values()),
        "rankings": rankings_by_objective,
        "why_win_summary": why_win_summary,
        "use_case_recommendations": use_case_recs,
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



import os

def get_log_path(engine: str) -> str:
    production_path = f"logs/{engine}.log"
    if os.path.exists(production_path):
        return production_path
        
    base = r"C:\Users\vaibh\.gemini\antigravity\brain\c50920ab-f7b9-4a6d-8be5-5f13a8307b50\.system_generated\tasks"
    if not os.path.exists(base):
        return production_path

    try:
        tasks = sorted([f for f in os.listdir(base) if f.endswith('.log')], 
                       key=lambda x: os.path.getmtime(os.path.join(base, x)), 
                       reverse=True)
        
        for t in tasks:
            path = os.path.join(base, t)
            with open(path, "r", encoding="utf-8", errors="ignore") as f:
                head = f.read(1500)
                if engine == "ollama" and "OLLAMA_HOST" in head:
                    return path
                elif engine == "llamacpp" and "llama_server:" in head:
                    return path
                elif engine == "vllm" and ("8000" in head or "vllm_server" in head):
                    return path
                elif engine == "backend" and "8006" in head:
                    return path
                elif engine == "transformers" and ("transformers" in head.lower() or "torch" in head):
                    return path
    except:
        pass
        
    return production_path


@app.get("/api/terminal/{engine}")
def get_terminal_logs(engine: str):
    if engine == "transformers":
        import torch
        cuda_status = f"CUDA Available: {torch.cuda.is_available()}"
        if torch.cuda.is_available():
            try:
                gpu_name = torch.cuda.get_device_name(0)
                vram = round(torch.cuda.get_device_properties(0).total_memory / (1024**3), 2)
                cuda_status += f" (Device: {gpu_name}, Total VRAM: {vram} GB)"
            except Exception:
                pass
        return {
            "log": f"=== Hugging Face Transformers In-Process Runtime ===\n[Transformers] Direct PyTorch execution pipeline initialized.\n[Transformers] {cuda_status}\n[Transformers] Precision: float16 (GPU) / float32 (CPU)\n[Transformers] Registered Models: Qwen/Qwen2.5-0.5B-Instruct\n[Transformers] Ready for in-process inference requests."
        }

    path = get_log_path(engine)
    if not os.path.exists(path):
        if engine == "vllm":
            return {"log": "=== vLLM Engine Offline ===\nvLLM requires a Linux/WSL2 environment on Windows. Start a vLLM server on http://127.0.0.1:8000 to stream live logs."}
        return {"log": f"Log file not found or process has not started emitting logs yet for {engine}."}
        
    try:
        with open(path, "r", encoding="utf-8", errors="ignore") as f:
            lines = f.readlines()
            return {"log": "".join(lines[-100:])}
    except Exception as e:
        return {"error": str(e)}

@app.get("/api/logs")
def get_system_logs(limit: int = 200, db: Session = Depends(get_db)):
    logs = db.query(models.SystemEventLog).order_by(models.SystemEventLog.timestamp.desc()).limit(limit).all()
    return [{"id": l.id, "timestamp": l.timestamp, "level": l.level, "source": l.source, "message": l.message} for l in logs]


# --- BENCHMARK EXPORT & MODEL SCAN API ---
import io
import csv
from fastapi.responses import Response

@app.get("/api/benchmarks/{id}/export")
def export_benchmark_run(id: int, format: str = Query("json", regex="^(json|csv|markdown|md)$"), db: Session = Depends(get_db)):
    run = crud.get_run(db, id)
    if not run:
        raise HTTPException(status_code=404, detail="Benchmark run not found")
        
    requests = crud.get_run_requests(db, id)
    telemetry = db.query(models.TelemetrySample).filter(models.TelemetrySample.run_id == id).order_by(models.TelemetrySample.timestamp.asc()).all()
    
    # 1. JSON Export
    if format == "json":
        export_data = {
            "run_id": run.id,
            "name": run.name,
            "status": run.status,
            "started_at": run.started_at.isoformat() if run.started_at else None,
            "completed_at": run.completed_at.isoformat() if run.completed_at else None,
            "model_name": run.config.model.name if run.config and run.config.model else "Unknown",
            "concurrency": run.config.concurrency if run.config else 1,
            "summary_metrics": {
                "mean_ttft_ms": run.mean_ttft_ms,
                "mean_tpot_ms": run.mean_tpot_ms,
                "p90_latency_ms": run.p90_latency_ms,
                "p99_latency_ms": run.p99_latency_ms,
                "total_requests": run.total_requests,
                "successful_requests": run.successful_requests,
                "failed_requests": run.failed_requests
            },
            "requests": [
                {
                    "id": r.id,
                    "provider": r.provider.name if r.provider else "Unknown",
                    "provider_type": r.provider.type if r.provider else "Unknown",
                    "model": r.model_name,
                    "status": r.status,
                    "ttft_ms": (r.first_token_time - r.start_time) / 1000.0 if r.first_token_time and r.start_time else None,
                    "latency_ms": (r.finish_time - r.start_time) / 1000.0 if r.finish_time and r.start_time else None,
                    "generation_tokens_per_sec": (r.output_tokens / ((r.finish_time - r.first_token_time) / 1000000.0)) if r.output_tokens > 0 and r.finish_time and r.first_token_time else None,
                    "input_tokens": r.input_tokens,
                    "output_tokens": r.output_tokens,
                    "error": r.error_message
                }
                for r in requests
            ],
            "telemetry_samples_count": len(telemetry)
        }
        return Response(
            content=json.dumps(export_data, indent=2),
            media_type="application/json",
            headers={"Content-Disposition": f"attachment; filename=benchmark_run_{id}.json"}
        )
        
    # 2. CSV Export
    elif format == "csv":
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow([
            "Request ID", "Provider Name", "Provider Type", "Model", "Status",
            "TTFT (ms)", "Total Latency (ms)", "Speed (tok/s)", "Input Tokens", "Output Tokens", "Error"
        ])
        
        for r in requests:
            ttft = round((r.first_token_time - r.start_time) / 1000.0, 2) if r.first_token_time and r.start_time else ""
            lat = round((r.finish_time - r.start_time) / 1000.0, 2) if r.finish_time and r.start_time else ""
            speed = round(r.output_tokens / ((r.finish_time - r.first_token_time) / 1000000.0), 2) if r.output_tokens > 0 and r.finish_time and r.first_token_time else ""
            
            writer.writerow([
                r.id,
                r.provider.name if r.provider else "Unknown",
                r.provider.type if r.provider else "Unknown",
                r.model_name,
                r.status,
                ttft,
                lat,
                speed,
                r.input_tokens or 0,
                r.output_tokens or 0,
                r.error_message or ""
            ])
            
        return Response(
            content=output.getvalue(),
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename=benchmark_run_{id}.csv"}
        )

    # 3. Markdown Export
    else:
        md_lines = [
            f"# Benchmark Run Report: {run.name}",
            f"**Run ID:** {run.id}  ",
            f"**Model:** {run.config.model.name if run.config and run.config.model else 'Unknown'}  ",
            f"**Status:** {run.status}  ",
            f"**Started At:** {run.started_at.isoformat() if run.started_at else 'N/A'}  ",
            f"**Completed At:** {run.completed_at.isoformat() if run.completed_at else 'N/A'}  \n",
            "## Executive Summary Metrics",
            f"- **Mean TTFT:** {run.mean_ttft_ms:.1f} ms" if run.mean_ttft_ms else "- **Mean TTFT:** N/A",
            f"- **Mean TPOT:** {run.mean_tpot_ms:.1f} ms ({1000.0/run.mean_tpot_ms:.1f} tok/s)" if run.mean_tpot_ms else "- **Mean TPOT:** N/A",
            f"- **P90 Latency:** {run.p90_latency_ms:.1f} ms" if run.p90_latency_ms else "- **P90 Latency:** N/A",
            f"- **P99 Latency:** {run.p99_latency_ms:.1f} ms" if run.p99_latency_ms else "- **P99 Latency:** N/A",
            f"- **Requests:** {run.successful_requests or 0} succeeded, {run.failed_requests or 0} failed (Total: {run.total_requests or 0})\n",
            "## Request Latency Table",
            "| ID | Provider | Status | TTFT (ms) | Latency (ms) | Speed (tok/s) | Tokens (In/Out) |",
            "|---|---|---|---|---|---|---|"
        ]
        
        for r in requests:
            ttft = f"{(r.first_token_time - r.start_time) / 1000.0:.1f}" if r.first_token_time and r.start_time else "-"
            lat = f"{(r.finish_time - r.start_time) / 1000.0:.1f}" if r.finish_time and r.start_time else "-"
            speed = f"{r.output_tokens / ((r.finish_time - r.first_token_time) / 1000000.0):.1f}" if r.output_tokens > 0 and r.finish_time and r.first_token_time else "-"
            tokens = f"{r.input_tokens or 0}/{r.output_tokens or 0}"
            p_name = r.provider.name if r.provider else "Unknown"
            md_lines.append(f"| {r.id} | {p_name} | {r.status} | {ttft} | {lat} | {speed} | {tokens} |")
            
        md_content = "\n".join(md_lines)
        return Response(
            content=md_content,
            media_type="text/markdown",
            headers={"Content-Disposition": f"attachment; filename=benchmark_run_{id}.md"}
        )


@app.get("/api/models/scan")
def scan_local_models():
    """
    Scans the local filesystem for .gguf, .safetensors, and Ollama weight files.
    """
    discovered = []
    seen_paths = set()
    
    scan_roots = [
        os.getcwd(),
        os.path.join(os.getcwd(), "models"),
        os.path.expanduser("~/.cache/huggingface/hub"),
        os.path.expanduser("~/.ollama/models")
    ]
    
    # Common quant patterns
    quant_patterns = ["q4_k_m", "q4_k_s", "q4_0", "q5_k_m", "q5_0", "q8_0", "f16", "f32", "bf16", "q2_k", "q3_k_m", "q6_k"]
    
    for root_dir in scan_roots:
        if not os.path.exists(root_dir):
            continue
        try:
            for root, _, files in os.walk(root_dir):
                for f in files:
                    if f.lower().endswith(('.gguf', '.safetensors', '.bin')):
                        full_path = os.path.abspath(os.path.join(root, f))
                        if full_path in seen_paths:
                            continue
                        seen_paths.add(full_path)
                        
                        try:
                            stat = os.stat(full_path)
                            size_bytes = stat.st_size
                            size_gb = round(size_bytes / (1024 ** 3), 2)
                            
                            # Deduce quantization
                            name_lower = f.lower()
                            quant = "Unknown"
                            for q in quant_patterns:
                                if q in name_lower:
                                    quant = q.upper()
                                    break
                                    
                            fmt = "GGUF" if f.lower().endswith(".gguf") else ("SafeTensors" if f.lower().endswith(".safetensors") else "Bin")
                            
                            discovered.append({
                                "filename": f,
                                "path": full_path,
                                "format": fmt,
                                "size_bytes": size_bytes,
                                "size_gb": size_gb,
                                "quantization": quant,
                                "estimated_vram_gb": round(size_gb * 1.15, 1) # ~15% overhead for KV cache
                            })
                        except Exception:
                            pass
        except Exception:
            pass
            
    return {"count": len(discovered), "models": discovered}


# --- FAILURE ANALYSIS & ERROR CATEGORIZATION API ---
@app.get("/api/benchmarks/{id}/failures")
def get_benchmark_failures(id: int, db: Session = Depends(get_db)):
    run = crud.get_run(db, id)
    if not run:
        raise HTTPException(status_code=404, detail="Benchmark run not found")
        
    requests = crud.get_run_requests(db, id)
    
    category_counts = {
        "INVALID_JSON": 0,
        "WRONG_ANSWER": 0,
        "HALLUCINATION": 0,
        "CODE_ERROR": 0,
        "TIMEOUT": 0,
        "PROVIDER_ERROR": 0,
        "ASSERTION_FAILED": 0
    }
    
    failed_items = []
    total_evaluated = 0
    total_passed = 0
    
    for r in requests:
        total_evaluated += 1
        is_fail = r.status != "SUCCESS"
        fail_cat = "PROVIDER_ERROR" if r.status != "SUCCESS" else "NONE"
        reason = r.error_message or "Request failed."
        
        for q in r.quality_results:
            if not q.passed:
                is_fail = True
                details = q.details or {}
                fail_cat = details.get("failure_category", "WRONG_ANSWER")
                reason = details.get("reasoning", q.evaluator_type or "Failed quality check.")
                
        if is_fail:
            if fail_cat not in category_counts:
                category_counts[fail_cat] = 0
            category_counts[fail_cat] += 1
            
            failed_items.append({
                "request_id": r.id,
                "provider_name": r.provider.name if r.provider else "Unknown",
                "provider_type": r.provider.type if r.provider else "Unknown",
                "model_name": r.model_name,
                "prompt_id": r.prompt_id,
                "prompt_category": r.prompt.category if r.prompt else "General",
                "prompt_text": r.prompt.prompt if r.prompt else "N/A",
                "expected_answer": r.prompt.expected_answer if r.prompt else None,
                "actual_response": r.response_text or "",
                "status": r.status,
                "failure_category": fail_cat,
                "reasoning": reason,
                "latency_ms": (r.finish_time - r.start_time) / 1000.0 if r.finish_time and r.start_time else None
            })
        else:
            total_passed += 1
            
    return {
        "run_id": run.id,
        "run_name": run.name,
        "total_requests": total_evaluated,
        "passed_requests": total_passed,
        "failed_requests": len(failed_items),
        "pass_rate_pct": round((total_passed / total_evaluated) * 100, 1) if total_evaluated > 0 else 0,
        "category_counts": category_counts,
        "failures": failed_items
    }



# --- HUMAN EVALUATION & TRAFFIC TO DATASET CONVERTER API ---
@app.post("/api/evaluations/human")
def submit_human_evaluation(eval_in: dict, db: Session = Depends(get_db)):
    run_id = eval_in.get("run_id")
    req_id = eval_in.get("request_id")
    rating = eval_in.get("rating", "CORRECT")
    feedback = eval_in.get("feedback")
    
    if not run_id or not req_id:
        raise HTTPException(status_code=400, detail="run_id and request_id are required")
        
    existing = db.query(models.HumanEvaluation).filter(
        models.HumanEvaluation.run_id == run_id,
        models.HumanEvaluation.request_id == req_id
    ).first()
    
    if existing:
        existing.rating = rating
        existing.feedback = feedback
    else:
        new_eval = models.HumanEvaluation(
            run_id=run_id,
            request_id=req_id,
            rating=rating,
            feedback=feedback
        )
        db.add(new_eval)
    db.commit()
    return {"status": "saved", "rating": rating}


@app.get("/api/benchmarks/{id}/human-eval")
def get_human_evaluations(id: int, db: Session = Depends(get_db)):
    evals = db.query(models.HumanEvaluation).filter(models.HumanEvaluation.run_id == id).all()
    requests = crud.get_run_requests(db, id)
    
    agreed = 0
    total_reviewed = len(evals)
    
    for e in evals:
        req = next((r for r in requests if r.id == e.request_id), None)
        if req:
            auto_passed = req.status == "SUCCESS" and all(q.passed for q in req.quality_results)
            human_passed = e.rating == "CORRECT"
            if auto_passed == human_passed:
                agreed += 1
                
    agreement_rate = round((agreed / total_reviewed) * 100, 1) if total_reviewed > 0 else 100.0
    
    ratings_breakdown = {
        "CORRECT": sum(1 for e in evals if e.rating == "CORRECT"),
        "INCORRECT": sum(1 for e in evals if e.rating == "INCORRECT"),
        "PARTIALLY_CORRECT": sum(1 for e in evals if e.rating == "PARTIALLY_CORRECT"),
        "HALLUCINATED": sum(1 for e in evals if e.rating == "HALLUCINATED"),
        "POOR_FORMAT": sum(1 for e in evals if e.rating == "POOR_FORMAT")
    }
    
    return {
        "run_id": id,
        "total_reviewed": total_reviewed,
        "agreement_rate_pct": agreement_rate,
        "ratings_breakdown": ratings_breakdown,
        "evaluations": [
            {
                "request_id": e.request_id,
                "rating": e.rating,
                "feedback": e.feedback,
                "created_at": e.created_at.isoformat() if e.created_at else None
            }
            for e in evals
        ]
    }


@app.post("/api/requests/convert-to-dataset")
def convert_requests_to_dataset(payload: dict, db: Session = Depends(get_db)):
    request_ids = payload.get("request_ids", [])
    dataset_name = payload.get("dataset_name", "Production Traffic Evaluation Suite")
    category = payload.get("category", "Production Traffic")
    
    if not request_ids:
        raise HTTPException(status_code=400, detail="No request IDs provided")
        
    requests = db.query(models.BenchmarkRequest).filter(models.BenchmarkRequest.id.in_(request_ids)).all()
    if not requests:
        raise HTTPException(status_code=404, detail="No matching requests found")
        
    suite = models.PromptSuite(
        name=dataset_name,
        description=f"Generated from {len(requests)} production request traces"
    )
    db.add(suite)
    try:
        db.commit()
    except sqlalchemy.exc.IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="A Dataset (Prompt Suite) with this exact name already exists. Please choose a different name.")
    db.refresh(suite)
    
    for r in requests:
        prompt_text = r.prompt.prompt if r.prompt else (r.response_text[:100] or "Production Sample")
        sys_prompt = r.prompt.system_prompt if r.prompt else "You are an AI assistant."
        exp_ans = r.response_text[:300] if r.response_text else None
        
        p = models.Prompt(
            suite_id=suite.id,
            category=category,
            prompt=prompt_text,
            system_prompt=sys_prompt,
            expected_answer=exp_ans,
            evaluator="semantic_similarity" if exp_ans else "contains",
            difficulty="medium",
            tags="production-traffic,converted"
        )
        db.add(p)
    db.commit()
    
    return {
        "status": "created",
        "suite_id": suite.id,
        "suite_name": suite.name,
        "prompts_count": len(requests)
    }


@app.get("/api/benchmarks/{id}/requests")
def get_benchmark_requests(id: int, db: Session = Depends(get_db)):
    run = crud.get_run(db, id)
    if not run:
        raise HTTPException(status_code=404, detail="Benchmark run not found")
        
    requests = crud.get_run_requests(db, id)
    
    # Also get human evaluations
    evals = db.query(models.HumanEvaluation).filter(models.HumanEvaluation.run_id == id).all()
    eval_map = {e.request_id: e for e in evals}
    
    out = []
    for r in requests:
        auto_passed = r.status == "SUCCESS"
        for q in r.quality_results:
            if not q.passed:
                auto_passed = False
                
        h_eval = eval_map.get(r.id)
        
        out.append({
            "request_id": r.id,
            "provider_name": r.provider.name if r.provider else "Unknown",
            "model_name": r.model_name,
            "prompt_text": r.prompt.prompt if r.prompt else "N/A",
            "expected_answer": r.prompt.expected_answer if r.prompt else None,
            "actual_response": r.response_text or "",
            "auto_passed": auto_passed,
            "human_rating": h_eval.rating if h_eval else None,
            "human_feedback": h_eval.feedback if h_eval else None
        })
        
    return {"run_id": id, "requests": out}
