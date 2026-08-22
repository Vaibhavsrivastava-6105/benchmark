"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { 
  Play, 
  Layers, 
  Activity, Power, 
  Clock, 
  Gauge, 
  AlertTriangle,
  ArrowRight,
  RefreshCw,
  Award,
  Download
} from "lucide-react";
import { 
  ResponsiveContainer, 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  Tooltip, 
  BarChart, 
  Bar, 
  Legend 
} from "recharts";

const API_BASE = "";

const ProviderCard = ({ provider }: { provider: any }) => {
  const [ping, setPing] = useState<number | null>(null);

  useEffect(() => {
    let mounted = true;
    const fetchPing = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/providers/${provider.id}/ping`);
        const data = await res.json();
        if (mounted) {
          if (data.ping_ms >= 0) setPing(data.ping_ms);
          else setPing(null);
        }
      } catch (e) {
        if (mounted) setPing(null);
      }
    };
    
    // Initial fetch
    fetchPing();
    
    // Poll every 3 seconds
    const interval = setInterval(fetchPing, 3000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [provider.id, provider.last_status]);

  const pt = provider.process_telemetry;
  const isOnline = pt ? pt.online : (provider.last_status === "ONLINE");
  const isNative = provider.type === "transformers";

  return (
    <div className="bg-[#0c0c0e] border border-zinc-800 rounded-xl p-1.5 flex flex-col justify-between hover:border-zinc-700 transition-colors h-12">
      <div className="flex justify-between items-center mb-1">
        <span className="font-bold text-xs text-white truncate pr-2">{provider.name}</span>
        <div className="flex items-center gap-2">
          <span className={`px-1.5 py-[1px] rounded text-[9px] uppercase font-bold border ${isOnline ? "bg-zinc-900 text-zinc-100 border-zinc-500" : "bg-zinc-900 text-zinc-500 border-zinc-800"}`}>
            {isOnline ? "ONLINE" : "OFFLINE"}
          </span>
          
        </div>
      </div>
      
      <div className="flex justify-between items-end mt-auto">
        <div className="text-[10px] text-zinc-500 font-medium tracking-wide uppercase">
          Network Latency
        </div>
        <div className="text-xs font-bold font-mono text-white">
          {ping !== null ? `${ping} ms` : (isOnline ? "Measuring..." : "--")}
        </div>
      </div>
    </div>
  );
};


interface Run {
  id: number;
  name: string;
  status: string;
  completed_requests: number;
  total_requests: number;
  duration_seconds: number;
  created_at: string;
  config: {
    model: { name: string };
    repetitions: number;
    concurrency: number;
  };
  mean_tpot_ms?: number;
  mean_ttft_ms?: number;
}

export default function Dashboard() {
  const router = useRouter();
  const [runs, setRuns] = useState<Run[]>([]);
  const [providers, setProviders] = useState<any[]>([]);
  const [activeRun, setActiveRun] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [systemStats, setSystemStats] = useState<any>(null);
  const [systemHistory, setSystemHistory] = useState<any[]>([]);
  
  // Simulated stats for top-level summaries if database is empty
  const [liveTelemetry, setLiveTelemetry] = useState<any[]>([]);

  // Load basic data

  const fetchData = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/runs`);
      const runsData = await res.json();
      setRuns(runsData);
      
      // Look for any active/running benchmark
      const active = runsData.find((r: Run) => r.status === "RUNNING" || r.status === "PENDING");
      if (active) {
        setActiveRun(active);
      } else {
        setActiveRun(null);
      }

      // Fetch static system info
      
      const provRes = await fetch(`${API_BASE}/api/providers`);
      const provData = await provRes.json();
      setProviders(provData);

      const sysRes = await fetch(`${API_BASE}/api/hardware`);
      const sysData = await sysRes.json();
      setSystemStats(sysData);
      if (sysData.live) {
        setSystemHistory(prev => {
          const next = [...prev, {
            tick: Date.now(),
            cpu: sysData.live.cpu_utilization,
            gpu0: sysData.live.gpu_utilization?.[0]?.utilization || 0,
            gpu1: sysData.live.gpu_utilization?.[1]?.utilization || 0
          }];
          return next.slice(-20); // Keep last 20 ticks
        });
      }
    } catch (err) {
      console.error("Failed to fetch dashboard data:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, []);

  // Connect to SSE stream for live updates
  useEffect(() => {
    const eventSource = new EventSource(`${API_BASE}/api/events`);
    
    eventSource.addEventListener("telemetry_update", (e: any) => {
      const data = JSON.parse(e.data);
      // Append to live telemetry history for chart rendering
      setLiveTelemetry(prev => {
        const next = [...prev, data];
        return next.slice(-20); // Keep last 20 ticks
      });
    });

    eventSource.addEventListener("request_completed", (e: any) => {
      // Re-fetch data on requests completing to update numbers
      fetchData();
    });

    eventSource.addEventListener("benchmark_completed", (e: any) => {
      setActiveRun(null);
      fetchData();
    });

    return () => {
      eventSource.close();
    };
  }, []);

  // Handle Export
  const handleExport = async (id: number, format: "json" | "csv") => {
    try {
      window.open(`${API_BASE}/api/runs/${id}/results`); // Quick view raw JSON
    } catch (err) {
      alert("Failed to export data");
    }
  };

  // Standard metrics
  const activeBenchmarkName = activeRun ? activeRun.name : "None (Idle)";
  const latestCompletedRun = runs.find(r => r.status === "COMPLETED");

  // Chart data helpers
  const getSpeedChartData = () => {
    if (liveTelemetry.length > 0 && activeRun) {
      return liveTelemetry.map((t, idx) => ({
        tick: idx,
        cpu: t.cpu_utilization,
        gpu0: t.gpu_utilization?.[0]?.utilization || 0,
        gpu1: t.gpu_utilization?.[1]?.utilization || 0
      }));
    }
    
    // Return actual real-time host history if idle
    if (systemHistory.length > 0) {
      return systemHistory.map((h, i) => ({
        ...h,
        tick: i // Normalize X axis for chart
      }));
    }

    return [{ tick: 0, cpu: 0, gpu0: 0, gpu1: 0 }];
  };

  return (
    <div className="p-2 xl:p-3 flex flex-col gap-2 flex-1 h-full overflow-hidden">
      {/* Top Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-sm font-bold tracking-tight">System Dashboard</h1>
          <p className="text-zinc-400 text-xs">Real-time LLM runtime serving telemetry and benchmark histories.</p>
        </div>
        <div className="flex gap-3">
          <button 
            onClick={fetchData}
            className="flex items-center gap-2 px-3 py-1.5 border border-zinc-800 rounded-lg text-sm bg-black text-zinc-400 hover:bg-zinc-900 hover:text-white transition-colors"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
          <Link 
            href="/benchmarks/new" 
            className="flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-semibold bg-white text-black text-zinc-950 shadow-sm border-0 font-medium  hover:bg-zinc-800 transition-colors transition-colors"
          >
            <Play className="h-4 w-4 fill-white " />
            Launch Benchmark
          </Link>
        </div>
      </div>

      {/* Live Active Benchmark Notification */}
      {activeRun && (
        <div className="bg-zinc-800 border border-white rounded-xl p-2 flex-none flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-zinc-800 animate-ping" />
              <span className="text-xs uppercase font-bold tracking-widest text-white">ACTIVE BENCHMARK RUNNING</span>
            </div>
            <h3 className="text-sm font-bold text-white">{activeRun.name}</h3>
            <p className="text-xs text-zinc-400">
              Running model: <span className="text-white font-mono">{activeRun.config?.model?.name}</span> | Progress: {activeRun.completed_requests} / {activeRun.total_requests} requests
            </p>
          </div>
          <Link 
            href={`/benchmarks/${activeRun.id}`}
            className="flex items-center gap-2 px-4 py-2 border border-white text-white text-xs font-medium rounded-lg bg-zinc-800 hover:bg-zinc-800 hover:text-white transition-all"
          >
            View Live Telemetry
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      )}

      
      {/* Live Engines & Hardware Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 flex-none">
        {providers.filter(p => ["Local llama.cpp (Auto-Setup)", "Local Hugging Face Transformers", "Local vLLM (Auto-Setup)", "Local Ollama"].includes(p.name)).map(provider => (
            <ProviderCard key={provider.id} provider={provider} />
          ))}
      </div>

      {/* Summary Cards */}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 flex-none">
        {/* Active Run Status */}
        <div className="bg-[#0c0c0e] border border-zinc-800 rounded-xl p-2 space-y-0.5">
          <div className="flex justify-between items-center text-zinc-400">
            <span className="text-xs uppercase tracking-wider font-bold">Active Engine</span>
            <Activity className="h-4 w-4 text-white" />
          </div>
          <div className="text-sm font-bold font-mono tracking-tight truncate">
            {activeBenchmarkName}
          </div>
          <div className="text-xs text-zinc-400">
            {activeRun ? "Telemetry feeds logging..." : "Runtimes standing by"}
          </div>
        </div>

        {/* Throughput */}
        <div className="bg-[#0c0c0e] border border-zinc-800 rounded-xl p-2 space-y-0.5">
          <div className="flex justify-between items-center text-zinc-400">
            <span className="text-xs uppercase tracking-wider font-bold">Mean Throughput</span>
            <Gauge className="h-4 w-4 text-white" />
          </div>
          <div className="text-base font-bold font-mono text-white">
            {activeRun ? "Calculating..." : (latestCompletedRun?.mean_tpot_ms ? (1000 / latestCompletedRun.mean_tpot_ms).toFixed(1) + " t/s" : "-- t/s")}
          </div>
          <div className="text-xs text-zinc-400">
            Across active GPU benchmarks
          </div>
        </div>

        {/* Latency (TTFT) */}
        <div className="bg-[#0c0c0e] border border-zinc-800 rounded-xl p-2 space-y-0.5">
          <div className="flex justify-between items-center text-zinc-400">
            <span className="text-xs uppercase tracking-wider font-bold">Average TTFT</span>
            <Clock className="h-4 w-4 text-white" />
          </div>
          <div className="text-base font-bold font-mono text-white">
            {activeRun ? "Calculating..." : (latestCompletedRun?.mean_ttft_ms ? latestCompletedRun.mean_ttft_ms.toFixed(0) + " ms" : "-- ms")}
          </div>
          <div className="text-xs text-zinc-400">
            Streaming first-token delay
          </div>
        </div>

        {/* GPU VRAM usage */}
        <div className="bg-[#0c0c0e] border border-zinc-800 rounded-xl p-2 space-y-0.5">
          <div className="flex justify-between items-center text-zinc-400">
            <span className="text-xs uppercase tracking-wider font-bold">VRAM Footprint</span>
            <Layers className="h-4 w-4 text-white" />
          </div>
          <div className="text-base font-bold font-mono text-white">
            {activeRun ? "Tracking..." : (systemStats?.live?.gpu_utilization?.[0] ? (systemStats.live.gpu_utilization[0].vram_used / 1024**3).toFixed(1) + " / " + (systemStats.live.gpu_utilization[0].vram_total / 1024**3).toFixed(0) + " GB" : "-- GB")}
          </div>
          <div className="text-xs text-zinc-400 truncate">
            {systemStats?.live?.gpu_utilization?.[0]?.name || "No GPU Detected"}
          </div>
        </div>
      </div>

      {/* Main Dashboard Workspace: Side-by-Side Telemetry & Experiments */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-2 flex-1 min-h-0 overflow-hidden">
        
        {/* Left Col (5/12): Hardware Telemetry & Specs */}
        <div className="lg:col-span-5 bg-[#0c0c0e] border border-zinc-800 rounded-xl p-2.5 flex flex-col gap-2 h-full overflow-hidden">
          <div className="flex justify-between items-center px-1">
            <h3 className="font-bold text-white text-xs">Hardware Telemetry & Specs</h3>
            <span className="text-[10px] text-zinc-500 font-mono">Sampling: 250ms</span>
          </div>
          
          {/* Chart */}
          <div className="h-32 min-h-[110px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={getSpeedChartData()}>
                <defs>
                  <linearGradient id="gpuGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ffffff" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#ffffff" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="cpuGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#888888" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#888888" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <XAxis dataKey="tick" stroke="#52525b" fontSize={9} tickLine={false} />
                <YAxis stroke="#52525b" fontSize={9} domain={[0, 100]} unit="%" tickLine={false} />
                <Tooltip 
                  contentStyle={{ backgroundColor: "#18181b", borderColor: "#27272a", borderRadius: "8px" }}
                  labelClassName="text-zinc-400 text-[10px]"
                />
                <Area type="monotone" dataKey="gpu0" stroke="#ffffff" fillOpacity={1} fill="url(#gpuGrad)" name="GPU Util %" />
                <Area type="monotone" dataKey="cpu" stroke="#888888" fillOpacity={1} fill="url(#cpuGrad)" name="CPU Util %" />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Live Specs */}
          {systemStats?.static && (
            <div className="bg-black/50 border border-zinc-800/60 rounded-lg p-2 font-mono text-[10px] space-y-1.5 flex-1 overflow-y-auto no-scrollbar min-h-0">
              <div className="flex justify-between items-center border-b border-zinc-800 pb-1">
                <span className="text-zinc-300 font-semibold">Live System Hardware</span>
                {systemStats.live && <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse"></span>}
              </div>
              
              {/* CPU */}
              <div className="text-zinc-400 flex flex-col gap-0.5">
                <div className="truncate"><span className="text-white">CPU:</span> {systemStats.static.cpu_model || "Unknown CPU"}</div>
                {systemStats.live && (
                  <div className="flex justify-between pl-2 border-l border-zinc-800 text-[9px]">
                    <span>Util: <span className="text-white">{systemStats.live.cpu_utilization.toFixed(1)}%</span></span>
                    <span>RAM: <span className="text-white">{(systemStats.live.ram_used_bytes / 1024**3).toFixed(1)} GB</span> / {(systemStats.static.ram_total_bytes / 1024**3).toFixed(1)} GB</span>
                  </div>
                )}
              </div>
              
              {/* GPU */}
              {systemStats.static.gpus?.map((g: any, i: number) => {
                const liveGpu = systemStats.live?.gpu_utilization?.find((l:any) => l.index === i) || null;
                return (
                  <div key={i} className="text-zinc-400 pt-1 border-t border-zinc-800/50 flex flex-col gap-0.5">
                    <div className="truncate"><span className="text-white">GPU {i}:</span> {g.name}</div>
                    {liveGpu ? (
                      <div className="flex justify-between pl-2 border-l border-zinc-800 text-[9px]">
                        <span>Util: <span className="text-white">{liveGpu.utilization}%</span></span>
                        <span>Temp: <span className="text-white">{liveGpu.temperature_celsius}C</span></span>
                        <span>VRAM: <span className="text-white">{(liveGpu.vram_used / 1024**3).toFixed(1)}</span> / {(g.vram_total / 1024**3).toFixed(1)} GB</span>
                      </div>
                    ) : (
                      <div><span className="text-white">VRAM:</span> {(g.vram_total / 1024**3).toFixed(1)} GB</div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Col (7/12): Recent Experiments Table */}
        <div className="lg:col-span-7 bg-[#0c0c0e] border border-zinc-800 rounded-xl p-2.5 flex flex-col h-full overflow-hidden">
          <div className="flex justify-between items-center pb-2 mb-1 border-b border-zinc-800">
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-white text-xs">Recent Experiments</h3>
              <span className="text-[10px] bg-zinc-900 border border-zinc-800 text-zinc-400 font-mono px-1.5 py-0.5 rounded">
                {runs.length} runs
              </span>
            </div>
            {latestCompletedRun && (
              <span className="text-[10px] text-zinc-400 font-mono truncate max-w-[200px]">
                Latest: <span className="text-white">{latestCompletedRun.name}</span>
              </span>
            )}
          </div>
          
          {loading ? (
            <div className="text-center py-12 text-zinc-400 text-xs">Querying database runs...</div>
          ) : runs.length === 0 ? (
            <div className="text-center py-12 border border-dashed border-zinc-800 rounded-xl space-y-2 m-2">
              <div className="text-xs font-semibold text-zinc-400">No benchmark experiments found</div>
              <p className="text-[10px] text-zinc-500">Launch a new benchmark run configuration to initialize comparative charts.</p>
            </div>
          ) : (
            <div className="overflow-y-auto no-scrollbar flex-1 min-h-0 pr-1">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="text-zinc-500 border-b border-zinc-800/80 font-mono text-[10px] uppercase">
                    <th className="py-2 px-2">Run Name</th>
                    <th className="py-2 px-2">Status</th>
                    <th className="py-2 px-2">Speed</th>
                    <th className="py-2 px-2">Model</th>
                    <th className="py-2 px-2">Duration</th>
                    <th className="py-2 px-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/50 font-mono text-xs">
                  {runs.map((r) => (
                    <tr key={r.id} className="hover:bg-zinc-900/40 transition-colors">
                      <td className="py-2 px-2 font-sans font-semibold text-white truncate max-w-[150px]" title={r.name}>
                        {r.name}
                      </td>
                      <td className="py-2 px-2">
                        <span className={`px-1.5 py-0.5 rounded text-[9px] uppercase font-bold border ${
                          r.status === "COMPLETED" ? "bg-zinc-900 text-white border-zinc-600" :
                          r.status === "RUNNING" ? "bg-black text-white border-white animate-pulse" :
                          r.status === "FAILED" ? "bg-zinc-900 text-zinc-500 border-zinc-800" :
                          "bg-black text-zinc-400 border-zinc-800"
                        }`}>
                          {r.status}
                        </span>
                      </td>
                      <td className="py-2 px-2 font-semibold text-white">
                        {r.status === "COMPLETED" && r.mean_tpot_ms ? `${(1000 / r.mean_tpot_ms).toFixed(1)} t/s` : "-"}
                      </td>
                      <td className="py-2 px-2 text-zinc-400 truncate max-w-[120px]" title={r.config?.model?.name}>
                        {r.config?.model?.name || "-"}
                      </td>
                      <td className="py-2 px-2 text-zinc-500 text-[10px]">
                        {r.duration_seconds ? `${r.duration_seconds.toFixed(1)}s` : "-"}
                      </td>
                      <td className="py-2 px-2 text-right space-x-1.5">
                        <Link 
                          href={`/benchmarks/${r.id}`}
                          className="px-2 py-0.5 text-[10px] border border-zinc-800 bg-black text-zinc-300 hover:text-white rounded hover:bg-zinc-800 transition-colors inline-block"
                        >
                          Inspect
                        </Link>
                        <button
                          onClick={() => handleExport(r.id, "json")}
                          className="p-1 border border-zinc-800 text-zinc-400 hover:text-white rounded hover:bg-zinc-800 transition-colors inline-block"
                          title="Download JSON Export"
                        >
                          <Download className="h-2.5 w-2.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}