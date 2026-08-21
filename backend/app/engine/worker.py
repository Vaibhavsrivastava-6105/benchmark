import asyncio
import logging
import traceback
import time
from typing import Dict, Any, Optional
from sqlalchemy.orm import Session
from app.database import SessionLocal
from app.models import BenchmarkRun, TelemetrySample
from app.engine.runner import BenchmarkRunner
from app.engine.telemetry import TelemetryCollector

logger = logging.getLogger(__name__)

# Queue of run IDs to execute
job_queue = asyncio.Queue()

# In-memory broadcaster for Server-Sent Events (SSE)
class EventBroadcaster:
    def __init__(self):
        self._listeners = set()

    def subscribe(self) -> asyncio.Queue:
        q = asyncio.Queue()
        self._listeners.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue):
        self._listeners.discard(q)

    def broadcast(self, event_type: str, data: Dict[str, Any]):
        for q in self._listeners:
            try:
                q.put_nowait({"event": event_type, "data": data})
            except Exception:
                pass

broadcaster = EventBroadcaster()

# Keep track of active runner objects to support stopping them remotely
active_runners: Dict[int, BenchmarkRunner] = {}

async def telemetry_sampler_task(run_id: int, stop_event: asyncio.Event):
    """
    Background worker that samples system CPU, RAM, and GPU telemetry
    every 250ms during an active benchmark run.
    """
    logger.info(f"Starting telemetry sampler for run {run_id}")
    db: Session = SessionLocal()
    try:
        while not stop_event.is_set():
            sample_data = TelemetryCollector.collect_all()
            
            # Save to db
            sample = TelemetrySample(
                run_id=run_id,
                timestamp=sample_data["timestamp"],
                cpu_utilization=sample_data["cpu_utilization"],
                ram_used_bytes=sample_data["ram_used_bytes"],
                ram_total_bytes=sample_data["ram_total_bytes"],
                gpu_utilization=sample_data["gpu_utilization"]
            )
            db.add(sample)
            db.commit()
            
            # Broadcast live update
            broadcaster.broadcast("telemetry_update", {
                "run_id": run_id,
                **sample_data
            })
            
            await asyncio.sleep(0.25)  # Sample every 250ms
    except Exception as e:
        logger.error(f"Error in telemetry sampler for run {run_id}: {str(e)}")
    finally:
        db.close()
        logger.info(f"Stopped telemetry sampler for run {run_id}")

async def run_executor_worker():
    """
    Long running background task that processes queued benchmark runs.
    """
    logger.info("Starting background benchmark executor worker...")
    while True:
        run_id = await job_queue.get()
        logger.info(f"De-queued run {run_id} for execution")
        
        db: Session = SessionLocal()
        telemetry_stop = asyncio.Event()
        telemetry_task = None
        
        try:
            # Check status is PENDING
            run = db.query(BenchmarkRun).filter(BenchmarkRun.id == run_id).first()
            if not run or run.status != "PENDING":
                logger.warning(f"Run {run_id} is not in PENDING state or was deleted. Skipping.")
                job_queue.task_done()
                continue
                
            # Create runner callback
            def on_event(event_type: str, data: Dict[str, Any]):
                # Broadcast events to connected clients
                broadcaster.broadcast(event_type, data)
                
            # Instantiate runner
            runner = BenchmarkRunner(db, run_id, event_callback=on_event)
            active_runners[run_id] = runner
            
            # Start telemetry sampling in background
            telemetry_task = asyncio.create_task(telemetry_sampler_task(run_id, telemetry_stop))
            
            # Run benchmark
            await runner.execute()
            
        except Exception as e:
            logger.error(f"Failed to execute benchmark run {run_id}: {str(e)}")
            logger.error(traceback.format_exc())
            
            # Mark failed in DB
            try:
                run = db.query(BenchmarkRun).filter(BenchmarkRun.id == run_id).first()
                if run:
                    run.status = "FAILED"
                    run.error_message = f"Executor error: {str(e)}"
                    db.commit()
                    broadcaster.broadcast("benchmark_completed", {"run_id": run_id, "status": "FAILED", "error": str(e)})
            except Exception:
                pass
        finally:
            # Stop telemetry
            telemetry_stop.set()
            if telemetry_task:
                try:
                    await telemetry_task
                except Exception:
                    pass
            
            # Cleanup active runners
            active_runners.pop(run_id, None)
            db.close()
            job_queue.task_done()

# Queue helper functions
def queue_run(run_id: int):
    job_queue.put_nowait(run_id)
    broadcaster.broadcast("benchmark_queued", {"run_id": run_id})

def stop_run(run_id: int) -> bool:
    """
    Request an active runner to stop execution.
    """
    runner = active_runners.get(run_id)
    if runner:
        runner.stop_requested = True
        return True
    return False
