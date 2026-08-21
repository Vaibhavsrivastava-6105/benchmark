"use client";
import React, { useEffect, useState } from "react";
import { Cpu, Server, Activity, Thermometer, Zap, AlertTriangle } from "lucide-react";

const API_BASE = "";

export default function HardwarePage() {
  const [hardware, setHardware] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    
    const fetchHardware = async () => {
      try {
        const url = (typeof API_BASE !== "undefined" ? API_BASE : "http://localhost:8001") + "/api/hardware";
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          if (isMounted) setHardware(data);
          setError(null);
        } else {
          setError("Failed to fetch hardware data.");
        }
      } catch (err: any) {
        if (isMounted) setError(err.message);
      }
    };

    fetchHardware();
    // Poll every 1 second
    const interval = setInterval(fetchHardware, 1000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  if (!hardware && !error) {
    return <div className="p-8 text-zinc-400">Detecting system hardware...</div>;
  }

  const { static: stat, live } = hardware || {};
  const gpus = live?.gpu_utilization || [];

  return (
    <div className="p-8 space-y-8 max-w-6xl">
      <div className="flex justify-between items-center pb-4 border-b border-zinc-800">
        <div>
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            <Cpu className="h-8 w-8 text-cyan-500" />
            Hardware Telemetry
          </h1>
          <p className="text-zinc-400 mt-2">Real-time system resource monitoring for the BenchLab server.</p>
        </div>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-500/50 p-4 rounded-lg flex items-center gap-3 text-red-400">
          <AlertTriangle className="h-5 w-5" />
          <p>{error}</p>
        </div>
      )}

      {hardware && stat && live && (
        <>
          {/* Static System Info */}
          <section className="bg-[#0c0c0e] border border-zinc-800 rounded-xl p-6">
            <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
              <Server className="h-5 w-5 text-zinc-400" /> Host System Information
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
              <div className="space-y-1">
                <p className="text-xs text-zinc-500 uppercase font-bold tracking-wider">OS</p>
                <p className="text-sm font-mono text-white">{stat.os}</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-zinc-500 uppercase font-bold tracking-wider">CPU Model</p>
                <p className="text-sm font-mono text-white">{stat.cpu_model}</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-zinc-500 uppercase font-bold tracking-wider">CPU Cores</p>
                <p className="text-sm font-mono text-white">{stat.cpu_cores} Logical Threads</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-zinc-500 uppercase font-bold tracking-wider">Total RAM</p>
                <p className="text-sm font-mono text-white">{(stat.ram_total_bytes / 1024 / 1024 / 1024).toFixed(1)} GB</p>
              </div>
            </div>
            {stat.demo_mode && (
              <div className="mt-4 p-3 bg-amber-900/20 border border-amber-900/50 text-amber-500 text-sm rounded flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" /> Running in DEMO_MODE (Simulated Telemetry)
              </div>
            )}
          </section>

          {/* Live Host Metrics */}
          <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* CPU */}
            <div className="bg-[#0c0c0e] border border-zinc-800 rounded-xl p-6">
              <h3 className="text-sm text-zinc-400 uppercase font-bold tracking-wider mb-4 flex items-center gap-2">
                <Activity className="h-4 w-4" /> CPU Utilization
              </h3>
              <div className="flex items-end gap-2 mb-2">
                <span className="text-4xl font-bold text-white">{live.cpu_utilization.toFixed(1)}</span>
                <span className="text-zinc-500 mb-1">%</span>
              </div>
              <div className="w-full bg-zinc-900 rounded-full h-2.5 mt-4 overflow-hidden">
                <div 
                  className="bg-cyan-500 h-2.5 rounded-full transition-all duration-300" 
                  style={{ width: `${live.cpu_utilization}%` }}
                ></div>
              </div>
            </div>

            {/* RAM */}
            <div className="bg-[#0c0c0e] border border-zinc-800 rounded-xl p-6">
              <h3 className="text-sm text-zinc-400 uppercase font-bold tracking-wider mb-4 flex items-center gap-2">
                <Activity className="h-4 w-4" /> System RAM
              </h3>
              <div className="flex items-end gap-2 mb-2">
                <span className="text-4xl font-bold text-white">{(live.ram_used_bytes / 1024 / 1024 / 1024).toFixed(1)}</span>
                <span className="text-zinc-500 mb-1">/ {(live.ram_total_bytes / 1024 / 1024 / 1024).toFixed(1)} GB</span>
              </div>
              <div className="w-full bg-zinc-900 rounded-full h-2.5 mt-4 overflow-hidden">
                <div 
                  className="bg-purple-500 h-2.5 rounded-full transition-all duration-300" 
                  style={{ width: `${(live.ram_used_bytes / live.ram_total_bytes) * 100}%` }}
                ></div>
              </div>
            </div>
          </section>

          {/* Live GPUs */}
          {gpus.length > 0 && (
            <section className="space-y-4">
              <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                <Server className="h-5 w-5 text-zinc-400" /> GPU Accelerators
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {gpus.map((gpu: any, i: number) => {
                  const memUsedGb = gpu.vram_used / 1024 / 1024 / 1024;
                  const memTotalGb = gpu.vram_total / 1024 / 1024 / 1024;
                  const memPct = (memUsedGb / memTotalGb) * 100;
                  
                  return (
                    <div key={i} className="bg-[#0c0c0e] border border-zinc-800 rounded-xl p-6 space-y-6">
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="bg-emerald-900/30 text-emerald-500 text-xs font-bold px-2 py-0.5 rounded uppercase">GPU {gpu.index}</span>
                          </div>
                          <h3 className="text-lg font-bold text-white">{gpu.name}</h3>
                        </div>
                        <div className="text-right">
                          <div className="flex items-center justify-end gap-1 text-zinc-400 text-sm">
                            <Thermometer className="h-4 w-4" /> {gpu.temperature_celsius}°C
                          </div>
                          <div className="flex items-center justify-end gap-1 text-zinc-400 text-sm mt-1">
                            <Zap className="h-4 w-4" /> {gpu.power_watts.toFixed(0)}W
                          </div>
                        </div>
                      </div>

                      <div className="space-y-4">
                        {/* GPU Compute */}
                        <div>
                          <div className="flex justify-between text-sm mb-1">
                            <span className="text-zinc-400">Compute Utilization</span>
                            <span className="font-mono text-white">{gpu.utilization.toFixed(1)}%</span>
                          </div>
                          <div className="w-full bg-zinc-900 rounded-full h-2 overflow-hidden">
                            <div 
                              className="bg-emerald-500 h-2 rounded-full transition-all duration-300" 
                              style={{ width: `${gpu.utilization}%` }}
                            ></div>
                          </div>
                        </div>

                        {/* GPU Memory */}
                        <div>
                          <div className="flex justify-between text-sm mb-1">
                            <span className="text-zinc-400">VRAM Usage</span>
                            <span className="font-mono text-white">{memUsedGb.toFixed(1)} / {memTotalGb.toFixed(1)} GB</span>
                          </div>
                          <div className="w-full bg-zinc-900 rounded-full h-2 overflow-hidden">
                            <div 
                              className="bg-blue-500 h-2 rounded-full transition-all duration-300" 
                              style={{ width: `${memPct}%` }}
                            ></div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
