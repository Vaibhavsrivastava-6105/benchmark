import asyncio
import logging
import json
import httpx
from typing import Dict, Any, Optional
from app.engine.worker import broadcaster

logger = logging.getLogger(__name__)

# Global dictionary tracking download statuses
# Format: {"model_name": {"status": "downloading"|"completed"|"failed", "progress": 45.0, "error": None, "info": ""}}
active_downloads: Dict[str, Dict[str, Any]] = {}

def get_download_status(model_name: str) -> Optional[Dict[str, Any]]:
    return active_downloads.get(model_name)

async def pull_ollama_model(base_url: str, model_name: str):
    """
    Pulls a model from Ollama registry streaming the progress chunks.
    """
    active_downloads[model_name] = {"status": "downloading", "progress": 0.0, "info": "Starting pull...", "error": None}
    broadcaster.broadcast("model_download", {"model": model_name, "status": "downloading", "progress": 0.0, "info": "Starting pull..."})
    
    # Strip v1 if present for the pull API endpoint (Ollama native pull is on base_url /api/pull)
    url = base_url.split("/v1")[0] + "/api/pull"
    
    try:
        async with httpx.AsyncClient(timeout=None) as client:
            async with client.stream("POST", url, json={"name": model_name, "stream": True}) as response:
                if response.status_code != 200:
                    raise Exception(f"Ollama returned HTTP status {response.status_code}")
                
                async for line in response.aiter_lines():
                    if not line.strip():
                        continue
                    try:
                        data = json.loads(line)
                        status_str = data.get("status", "")
                        completed = data.get("completed", 0)
                        total = data.get("total", 0)
                        
                        progress = 0.0
                        if total > 0:
                            progress = round((completed / total) * 100.0, 1)
                        
                        active_downloads[model_name] = {
                            "status": "downloading",
                            "progress": progress,
                            "info": status_str,
                            "error": None
                        }
                        broadcaster.broadcast("model_download", {
                            "model": model_name,
                            "status": "downloading",
                            "progress": progress,
                            "info": status_str
                        })
                    except Exception:
                        pass
        
        active_downloads[model_name] = {"status": "completed", "progress": 100.0, "info": "Completed!", "error": None}
        broadcaster.broadcast("model_download", {"model": model_name, "status": "completed", "progress": 100.0, "info": "Completed!"})
        logger.info(f"Ollama model {model_name} pulled successfully")
        
    except Exception as e:
        logger.error(f"Failed to pull Ollama model {model_name}: {str(e)}")
        active_downloads[model_name] = {"status": "failed", "progress": 0.0, "info": "Failed", "error": str(e)}
        broadcaster.broadcast("model_download", {"model": model_name, "status": "failed", "progress": 0.0, "info": "Failed", "error": str(e)})


async def download_hf_model(model_name: str):
    """
    Downloads a model from Hugging Face Hub on a background thread.
    """
    active_downloads[model_name] = {"status": "downloading", "progress": 0.0, "info": "Initializing HF download...", "error": None}
    broadcaster.broadcast("model_download", {"model": model_name, "status": "downloading", "progress": 0.0, "info": "Initializing HF download..."})
    
    try:
        from huggingface_hub import snapshot_download
        
        # Define a custom progress tracker using a wrapper over tqdm
        class CustomTqdm:
            def __init__(self, *args, **kwargs):
                self.total = kwargs.get("total", 100)
                self.n = 0
                self.desc = kwargs.get("desc", "Downloading")
                
            def update(self, n=1):
                self.n += n
                pct = round((self.n / self.total) * 100.0, 1) if self.total else 0.0
                active_downloads[model_name] = {
                    "status": "downloading",
                    "progress": pct,
                    "info": f"{self.desc or 'Downloading'}",
                    "error": None
                }
                broadcaster.broadcast("model_download", {
                    "model": model_name,
                    "status": "downloading",
                    "progress": pct,
                    "info": f"{self.desc or 'Downloading'}"
                })
                
            def close(self):
                pass

        def do_download():
            snapshot_download(
                repo_id=model_name,
                tqdm_class=CustomTqdm,
            )
            
        await asyncio.to_thread(do_download)
        
        active_downloads[model_name] = {"status": "completed", "progress": 100.0, "info": "Completed!", "error": None}
        broadcaster.broadcast("model_download", {"model": model_name, "status": "completed", "progress": 100.0, "info": "Completed!"})
        logger.info(f"Hugging Face model {model_name} downloaded successfully")
        
    except Exception as e:
        logger.error(f"Failed to download Hugging Face model {model_name}: {str(e)}")
        active_downloads[model_name] = {"status": "failed", "progress": 0.0, "info": "Failed", "error": str(e)}
        broadcaster.broadcast("model_download", {"model": model_name, "status": "failed", "progress": 0.0, "info": "Failed", "error": str(e)})
