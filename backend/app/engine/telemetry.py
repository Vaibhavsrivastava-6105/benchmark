import os
import time
import psutil
from typing import Dict, Any, List

# Check if pynvml is available for NVIDIA GPU telemetry
nvml_available = False
try:
    import pynvml
    pynvml.nvmlInit()
    nvml_available = True
except Exception:
    pass


class TelemetryCollector:
    @staticmethod
    def collect_host_telemetry() -> Dict[str, Any]:
        """
        Collect CPU & System RAM telemetry.
        """
        cpu_pct = psutil.cpu_percent(interval=None)
        mem = psutil.virtual_memory()
        
        return {
            "cpu_utilization": cpu_pct,
            "ram_used_bytes": mem.used,
            "ram_total_bytes": mem.total,
            "ram_percent": mem.percent
        }

    @staticmethod
    def collect_gpu_telemetry() -> List[Dict[str, Any]]:
        """
        Collect metrics for all local NVIDIA GPUs. Fallbacks to demo simulation if DEMO_MODE=true.
        """
        # 1. Demo Mode Simulation
        # 2. Real NVML Hardware Collection
        gpus = []
        if not nvml_available:
            return gpus

        try:
            device_count = pynvml.nvmlDeviceGetCount()
            for i in range(device_count):
                handle = pynvml.nvmlDeviceGetHandleByIndex(i)
                
                name = pynvml.nvmlDeviceGetName(handle)
                if isinstance(name, bytes):
                    name = name.decode("utf-8")
                
                # Utilization
                try:
                    util = pynvml.nvmlDeviceGetUtilizationRates(handle)
                    gpu_util = util.gpu  # %
                except Exception as e:
                    gpu_util = 0
                
                # Memory
                mem_info = pynvml.nvmlDeviceGetMemoryInfo(handle)
                vram_used = mem_info.used  # bytes
                vram_total = mem_info.total  # bytes
                
                # Power (NVML returns milliwatts, convert to watts)
                try:
                    power = pynvml.nvmlDeviceGetPowerUsage(handle) / 1000.0
                except Exception:
                    power = 0.0
                    
                # Temp
                try:
                    temp = pynvml.nvmlDeviceGetTemperature(handle, pynvml.NVML_TEMPERATURE_GPU)
                except Exception:
                    temp = 0
                    
                gpus.append({
                    "index": i,
                    "name": name,
                    "utilization": gpu_util,
                    "vram_used": vram_used,
                    "vram_total": vram_total,
                    "power_watts": power,
                    "temperature_celsius": temp
                })
        except Exception as e:
            import traceback
            print('NVML ERROR:', traceback.format_exc())
            pass
            
        return gpus

    @classmethod
    def collect_all(cls) -> Dict[str, Any]:
        host = cls.collect_host_telemetry()
        gpus = cls.collect_gpu_telemetry()
        
        return {
            "timestamp": time.time_ns() // 1000, # epoch microseconds
            "cpu_utilization": host["cpu_utilization"],
            "ram_used_bytes": host["ram_used_bytes"],
            "ram_total_bytes": host["ram_total_bytes"],
            "gpu_utilization": gpus
        }

    @staticmethod
    def get_hardware_static_info() -> Dict[str, Any]:
        """
        Gathers static hardware environment info for run metadata.
        """
        mem = psutil.virtual_memory()
        cpu_count = psutil.cpu_count(logical=True)
        cpu_freq = psutil.cpu_freq()
        
        gpu_info = []
        if nvml_available:
            try:
                device_count = pynvml.nvmlDeviceGetCount()
                for i in range(device_count):
                    handle = pynvml.nvmlDeviceGetHandleByIndex(i)
                    name = pynvml.nvmlDeviceGetName(handle)
                    if isinstance(name, bytes):
                        name = name.decode("utf-8")
                    mem_info = pynvml.nvmlDeviceGetMemoryInfo(handle)
                    gpu_info.append({
                        "name": name,
                        "vram_total": mem_info.total
                    })
            except Exception:
                pass

        return {
            "os": os.name,
            "cpu_model": "System Processor Pool",
            "cpu_cores": cpu_count,
            "cpu_max_frequency_mhz": cpu_freq.max if cpu_freq else "N/A",
            "ram_total_bytes": mem.total,
            "gpus": gpu_info
        }
