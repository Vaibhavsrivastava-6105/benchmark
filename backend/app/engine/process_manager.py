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

def start_provider(provider_type: str):
    if provider_type == "openai_compatible":
        # Hacky assumption for Ollama
        subprocess.Popen(["ollama", "serve"], creationflags=subprocess.CREATE_NEW_PROCESS_GROUP)
    elif provider_type == "llamacpp":
        cwd = os.path.abspath("bin/llama-cpp")
        subprocess.Popen(["llama-server.exe", "-m", "model.gguf", "--port", "8080", "--host", "127.0.0.1"], 
                         cwd=cwd, creationflags=subprocess.CREATE_NEW_PROCESS_GROUP)

def stop_provider(port: int):
    pid = get_pid_by_port(port)
    if pid:
        try:
            psutil.Process(pid).kill()
        except Exception:
            pass
