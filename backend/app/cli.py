import os
import sys
import click
import yaml
import json
import csv
import asyncio
from sqlalchemy.orm import Session
from datetime import datetime

# Adjust Python path to load modules correctly if running from directory
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database import SessionLocal, Base, engine
from app import models, crud, schemas
from app.engine.runner import BenchmarkRunner
from app.engine.telemetry import TelemetryCollector
from app.engine.recommendation import RecommendationEngine

# Helper for async running in Click commands
def async_command(f):
    import functools
    @functools.wraps(f)
    def wrapper(*args, **kwargs):
        return asyncio.run(f(*args, **kwargs))
    return wrapper

@click.group()
def cli():
    """LLM Benchmark Lab CLI Tool"""
    # Ensure tables exist
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        crud.seed_database(db)
    finally:
        db.close()

@cli.command("providers")
def list_providers():
    """List all registered inference providers."""
    db = SessionLocal()
    try:
        providers = crud.get_providers(db)
        click.echo(f"{'ID':<4} | {'Name':<24} | {'Type':<12} | {'Base URL':<36} | {'Enabled':<8}")
        click.echo("-" * 90)
        for p in providers:
            click.echo(f"{p.id:<4} | {p.name[:24]:<24} | {p.type:<12} | {p.base_url[:36]:<36} | {str(p.enabled):<8}")
    finally:
        db.close()

@cli.command("hardware")
def show_hardware():
    """Display system hardware static configuration and dynamic stats."""
    static = TelemetryCollector.get_hardware_static_info()
    live = TelemetryCollector.collect_all()
    
    click.echo("=== Static Hardware Info ===")
    click.echo(f"OS: {static.get('os')}")
    click.echo(f"CPU Cores: {static.get('cpu_cores')}")
    click.echo(f"RAM Total: {static.get('ram_total_bytes') / (1024**3):.1f} GB")
    click.echo("GPUs:")
    for i, g in enumerate(static.get("gpus", [])):
        click.echo(f"  GPU {i}: {g['name']} ({g['vram_total'] / (1024**3):.1f} GB VRAM)")
        
    click.echo("\n=== Live System Telemetry ===")
    click.echo(f"CPU Utilization: {live['cpu_utilization']:.1f}%")
    click.echo(f"RAM Used: {live['ram_used_bytes'] / (1024**3):.1f} / {live['ram_total_bytes'] / (1024**3):.1f} GB")
    if live.get("gpu_utilization"):
        click.echo("GPU Status:")
        for g in live["gpu_utilization"]:
            click.echo(f"  GPU {g['index']}: {g['name']} | Util: {g['utilization']}% | Temp: {g['temperature_celsius']}C | Power: {g['power_watts']}W")

@cli.command("list-runs")
def list_runs():
    """List previous benchmarking runs."""
    db = SessionLocal()
    try:
        runs = crud.get_runs(db)
        click.echo(f"{'ID':<4} | {'Run Name':<30} | {'Status':<10} | {'Requests':<8} | {'Duration':<8} | {'Created At':<20}")
        click.echo("-" * 90)
        for r in runs:
            duration = f"{r.duration_seconds:.1f}s" if r.duration_seconds else "N/A"
            created = r.created_at.strftime("%Y-%m-%d %H:%M") if r.created_at else "N/A"
            reqs = f"{r.completed_requests}/{r.total_requests}"
            click.echo(f"{r.id:<4} | {r.name[:30]:<30} | {r.status:<10} | {reqs:<8} | {duration:<8} | {created:<20}")
    finally:
        db.close()

@cli.command("run")
@click.argument("config_file", type=click.Path(exists=True))
@async_command
async def run_benchmark(config_file):
    """Execute a benchmark using a YAML configuration file."""
    with open(config_file, "r") as f:
        config_data = yaml.safe_load(f)

    db = SessionLocal()
    try:
        click.echo(f"Parsed config '{config_data.get('name')}' successfully.")
        
        # Build config create request
        cfg_create = schemas.BenchmarkConfigCreate(
            name=config_data.get("name", "CLI Run"),
            model_name=config_data.get("model_name"),
            temperature=config_data.get("temperature", 0.0),
            top_p=config_data.get("top_p", 1.0),
            seed=config_data.get("seed", 42),
            max_tokens=config_data.get("max_tokens", 128),
            repetitions=config_data.get("repetitions", 3),
            warmup_requests=config_data.get("warmup_requests", 1),
            concurrency=config_data.get("concurrency", 1)
        )
        
        run_create = schemas.BenchmarkRunCreate(
            name=config_data.get("name", "CLI Run"),
            config_create=cfg_create,
            provider_ids=config_data.get("provider_ids", [1]),
            prompt_suite_ids=config_data.get("prompt_suite_ids", [1])
        )
        
        # Save pending run in DB
        db_run = crud.create_benchmark_run(db, run_create)
        click.echo(f"Created Benchmark Run ID: {db_run.id} (Status: PENDING)")
        
        # Setup event emitter to print progress live
        def on_event(event_type: str, data: dict):
            if event_type == "request_started":
                click.echo(f" -> Request started (Index {data.get('request_index')}) on {data.get('provider')}")
            elif event_type == "first_token":
                click.echo(f"   -> [TTFT] First token received in {data.get('ttft_ms'):.1f}ms")
            elif event_type == "request_completed":
                click.echo(f"   -> [SUCCESS] Completed. Speed: {data.get('tokens_per_sec'):.1f} tok/s")
            elif event_type == "request_failed":
                click.echo(f"   -> [FAILED] Error: {data.get('error')}")
            elif event_type == "benchmark_completed":
                click.echo(f"=== Benchmark Completed (Status: {data.get('status')}) ===")

        runner = BenchmarkRunner(db, db_run.id, event_callback=on_event)
        
        click.echo("Starting Benchmark execution...")
        await runner.execute()
        
    except Exception as e:
        click.echo(f"Error running benchmark: {str(e)}", err=True)
    finally:
        db.close()

@cli.command("compare")
@click.argument("run_ids", nargs=-1, type=int, required=True)
def compare_runs(run_ids):
    """Compare multiple benchmark run results side-by-side."""
    db = SessionLocal()
    try:
        runs = db.query(models.BenchmarkRun).filter(models.BenchmarkRun.id.in_(run_ids)).all()
        if not runs:
            click.echo("No matching runs found.", err=True)
            return

        flat_requests = []
        telemetry_samples = []
        for r in runs:
            requests = crud.get_run_requests(db, r.id)
            for req in requests:
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
            samples = crud.get_run_telemetry(db, r.id)
            for s in samples:
                telemetry_samples.append({"run_id": r.id, "gpu_utilization": s.gpu_utilization})

        if not flat_requests:
            click.echo("No request logs found for selected runs.", err=True)
            return

        metrics = RecommendationEngine.calculate_metrics(flat_requests, telemetry_samples)
        rankings = RecommendationEngine.rank_providers(metrics, objective="best_overall")

        click.echo("=== Side-by-Side Runtime Comparison ===")
        click.echo(f"{'Runtime':<20} | {'Type':<8} | {'Throughput':<12} | {'TTFT':<8} | {'VRAM':<6} | {'Reliability':<11} | {'Quality':<7}")
        click.echo("-" * 90)
        for r in rankings:
            m = r["metrics"]
            ttft_str = f"{m['ttft_ms']:.1f}ms" if m["ttft_ms"] else "N/A"
            click.echo(
                f"{m['provider_name'][:20]:<20} | {m['provider_type']:<8} | "
                f"{m['throughput_tok_s']:>7.1f} tok/s | {ttft_str:>8} | {m['vram_used_gb']:>4.1f}GB | "
                f"{m['reliability_pct']:>9.1f}% | {m['quality_pct']:>6.1f}%"
            )
            
        # Overall Recommendation Winner
        if rankings:
            click.echo("\n[WINNER] Recommendation Engine Verdict:")
            top = rankings[0]
            click.echo(
                f"Winner: {top['provider_name']} ({top['provider_type'].upper()}) with balanced score: {top['composite_score']}/100. "
                f"Best option for high throughput and answer reliability."
            )
    finally:
        db.close()

@cli.command("export")
@click.argument("run_id", type=int)
@click.option("--format", type=click.Choice(["json", "csv"]), default="json", help="Export format")
@click.option("--output", type=click.Path(), help="Output file path")
def export_run(run_id, format, output):
    """Export request-level logs for a run to JSON or CSV format."""
    db = SessionLocal()
    try:
        run = crud.get_run(db, run_id)
        if not run:
            click.echo(f"Run {run_id} not found.", err=True)
            return
            
        requests = crud.get_run_requests(db, run_id)
        data = []
        for r in requests:
            data.append({
                "request_id": r.id,
                "provider": r.provider.name,
                "runtime": r.provider.type,
                "model": r.model_name,
                "prompt_id": r.prompt_id,
                "repetition": r.repetition_index,
                "status": r.status,
                "latency_ms": (r.finish_time - r.start_time) / 1000.0 if r.finish_time and r.start_time else None,
                "ttft_ms": (r.first_token_time - r.start_time) / 1000.0 if r.first_token_time and r.start_time else None,
                "prompt_tokens": r.prompt_tokens,
                "output_tokens": r.output_tokens,
                "tokens_per_sec": r.output_tokens / ((r.finish_time - (r.first_token_time or r.start_time)) / 1000000.0) if r.output_tokens > 0 and r.finish_time else 0.0,
                "error": r.error_message,
                "http_status": r.http_status
            })

        out_path = output or f"run_{run_id}_export.{format}"
        if format == "json":
            with open(out_path, "w") as f:
                json.dump(data, f, indent=2)
        else:
            if data:
                keys = data[0].keys()
                with open(out_path, "w", newline="") as f:
                    dict_writer = csv.DictWriter(f, keys)
                    dict_writer.writeheader()
                    dict_writer.writerows(data)
                    
        click.echo(f"Exported {len(data)} request logs to {out_path} successfully.")
    finally:
        db.close()

if __name__ == "__main__":
    cli()
