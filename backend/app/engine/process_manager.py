import psutil
import subprocess
import os
import urllib.parse
from typing import Dict, Any

def get_pid_by_port(port: int) -> int:
    for conn in psutil.net_connections(kind="inet"):
        if conn.laddr.port == port and conn.status == "LISTEN":
            return conn.pid
    return None

def get_process_telemetry(port: int) -> Dict[str, Any]:
    pid = get_pid_by_port(port)
    if not pid:
        return {"online": False, "cpu": 0, "ram_bytes": 0, "vram_bytes": "N/A"}
    try:
        p = psutil.Process(pid)
        cpu = p.cpu_percent(interval=0.05)
        ram = p.memory_info().rss
        return {"online": True, "cpu": cpu, "ram_bytes": ram, "vram_bytes": "N/A"}
    except Exception:
        return {"online": False, "cpu": 0, "ram_bytes": 0, "vram_bytes": "N/A"}

def start_provider_with_model(provider_type: str, model_name: str, base_url: str = None):
    if provider_type == "openai_compatible":
        # Hacky assumption for Ollama
        subprocess.Popen("ollama serve", shell=True, creationflags=subprocess.CREATE_NEW_PROCESS_GROUP)
    elif provider_type == "llamacpp":
        cwd = os.path.abspath("bin/llama-cpp")
        exe = os.path.join(cwd, "llama-server.exe")
        port = "8080"
        if base_url:
            import urllib.parse
            parsed = urllib.parse.urlparse(base_url)
            if parsed.port:
                port = str(parsed.port)
        # Check if model exists, else fallback to model.gguf
        model_path = model_name
        if not os.path.exists(os.path.join(cwd, model_path)):
            # If the user passed a path like "backend/bin/llama-cpp/xyz.gguf", extract basename
            basename = os.path.basename(model_path)
            if os.path.exists(os.path.join(cwd, basename)):
                model_path = basename
            else:
                model_path = "model.gguf" # ultimate fallback
        
        subprocess.Popen([exe, "-m", model_path, "--port", port, "--host", "127.0.0.1"], 
                         cwd=cwd, creationflags=subprocess.CREATE_NEW_PROCESS_GROUP)
    elif provider_type == "vllm":
        pass

def start_provider(provider_type: str):
    start_provider_with_model(provider_type, "model.gguf")

def stop_provider(port: int):
    pid = get_pid_by_port(port)
    if pid:
        try:
            psutil.Process(pid).kill()
        except Exception:
            pass
