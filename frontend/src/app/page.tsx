"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { 
  Play, 
  Layers, 
  Activity, 
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
    <div className="p-8 space-y-8 flex-1">
      {/* Top Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">System Dashboard</h1>
          <p className="text-zinc-400 text-sm mt-1">Real-time LLM runtime serving telemetry and benchmark histories.</p>
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
            className="flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-semibold bg-cyan-500 text-zinc-950 shadow-sm border-0 font-medium  hover:bg-cyan-400 transition-colors transition-colors"
          >
            <Play className="h-4 w-4 fill-white " />
            Launch Benchmark
          </Link>
        </div>
      </div>

      {/* Live Active Benchmark Notification */}
      {activeRun && (
        <div className="bg-cyan-950/30 border border-cyan-900/50 rounded-xl p-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-cyan-400 animate-ping" />
              <span className="text-xs uppercase font-bold tracking-widest text-cyan-500">ACTIVE BENCHMARK RUNNING</span>
            </div>
            <h3 className="text-lg font-bold text-white">{activeRun.name}</h3>
            <p className="text-sm text-zinc-400">
              Running model: <span className="text-white font-mono">{activeRun.config?.model?.name}</span> | Progress: {activeRun.completed_requests} / {activeRun.total_requests} requests
            </p>
          </div>
          <Link 
            href={`/benchmarks/${activeRun.id}`}
            className="flex items-center gap-2 px-4 py-2 border border-cyan-900/50 text-cyan-400 text-sm font-medium rounded-lg bg-cyan-900/50 hover:bg-cyan-800 hover:text-white transition-all"
          >
            View Live Telemetry
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      )}

      
      {/* Live Engines & Hardware Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {providers.filter(p => ["vllm", "ollama", "transformers", "llamacpp"].includes(p.type)).map(provider => {
          
          const isOnline = provider.status === "ONLINE";
          const sysLive = systemStats?.live || {};
          const cpu = sysLive.cpu_utilization || 0;
          const gpuObj = sysLive.gpu_utilization && sysLive.gpu_utilization.length > 0 ? sysLive.gpu_utilization[0] : null;
          const gpuUtil = gpuObj?.utilization || 0;
          const vramUsed = gpuObj ? (gpuObj.vram_used / (1024 ** 3)).toFixed(1) : "0";
          const vramTotal = gpuObj ? (gpuObj.vram_total / (1024 ** 3)).toFixed(1) : "0";

          return (
            <div key={provider.id} className="bg-[#0c0c0e] border border-zinc-800 rounded-xl p-4 flex flex-col justify-between hover:border-zinc-700 transition-colors">
              <div className="flex justify-between items-center mb-3">
                <span className="font-bold text-sm text-white truncate pr-2">{provider.name}</span>
                <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold border ${isOnline ? "bg-emerald-950 text-emerald-400 border-emerald-800" : "bg-zinc-900 text-zinc-500 border-zinc-800"}`}>
                  {provider.status || "OFFLINE"}
                </span>
              </div>
              
              <div className="space-y-3">
                {/* CPU */}
                <div>
                  <div className="flex justify-between text-xs text-zinc-400 mb-1">
                    <span>System CPU</span>
                    <span className="font-mono">{cpu}%</span>
                  </div>
                  <div className="w-full bg-zinc-900 h-1.5 rounded-full overflow-hidden">
                    <div className="bg-fuchsia-500 h-full transition-all" style={{width: `${cpu}%`}}></div>
                  </div>
                </div>

                {/* GPU */}
                <div>
                  <div className="flex justify-between text-xs text-zinc-400 mb-1">
                    <span>GPU Core</span>
                    <span className="font-mono">{gpuUtil}%</span>
                  </div>
                  <div className="w-full bg-zinc-900 h-1.5 rounded-full overflow-hidden">
                    <div className="bg-cyan-500 h-full transition-all" style={{width: `${gpuUtil}%`}}></div>
                  </div>
                </div>

                {/* VRAM */}
                <div>
                  <div className="flex justify-between text-xs text-zinc-400 mb-1">
                    <span>GPU VRAM</span>
                    <span className="font-mono">{vramUsed} / {vramTotal} GB</span>
                  </div>
                  <div className="w-full bg-zinc-900 h-1.5 rounded-full overflow-hidden">
                    <div className="bg-emerald-500 h-full transition-all" style={{width: `${gpuObj ? (gpuObj.vram_used / gpuObj.vram_total)*100 : 0}%`}}></div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Summary Cards */}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* Active Run Status */}
        <div className="bg-[#0c0c0e] border border-zinc-800 rounded-xl p-5 space-y-2">
          <div className="flex justify-between items-center text-zinc-400">
            <span className="text-xs uppercase tracking-wider font-bold">Active Engine</span>
            <Activity className="h-4 w-4 text-cyan-500" />
          </div>
          <div className="text-xl font-bold font-mono tracking-tight truncate">
            {activeBenchmarkName}
          </div>
          <div className="text-xs text-zinc-400">
            {activeRun ? "Telemetry feeds logging..." : "Runtimes standing by"}
          </div>
        </div>

        {/* Throughput */}
        <div className="bg-[#0c0c0e] border border-zinc-800 rounded-xl p-5 space-y-2">
          <div className="flex justify-between items-center text-zinc-400">
            <span className="text-xs uppercase tracking-wider font-bold">Mean Throughput</span>
            <Gauge className="h-4 w-4 text-green-500" />
          </div>
          <div className="text-2xl font-bold font-mono text-green-500">
            {activeRun ? "Calculating..." : (latestCompletedRun?.mean_tpot_ms ? (1000 / latestCompletedRun.mean_tpot_ms).toFixed(1) + " t/s" : "-- t/s")}
          </div>
          <div className="text-xs text-zinc-400">
            Across active GPU benchmarks
          </div>
        </div>

        {/* Latency (TTFT) */}
        <div className="bg-[#0c0c0e] border border-zinc-800 rounded-xl p-5 space-y-2">
          <div className="flex justify-between items-center text-zinc-400">
            <span className="text-xs uppercase tracking-wider font-bold">Average TTFT</span>
            <Clock className="h-4 w-4 text-orange-500" />
          </div>
          <div className="text-2xl font-bold font-mono text-orange-500">
            {activeRun ? "Calculating..." : (latestCompletedRun?.mean_ttft_ms ? latestCompletedRun.mean_ttft_ms.toFixed(0) + " ms" : "-- ms")}
          </div>
          <div className="text-xs text-zinc-400">
            Streaming first-token delay
          </div>
        </div>

        {/* GPU VRAM usage */}
        <div className="bg-[#0c0c0e] border border-zinc-800 rounded-xl p-5 space-y-2">
          <div className="flex justify-between items-center text-zinc-400">
            <span className="text-xs uppercase tracking-wider font-bold">VRAM Footprint</span>
            <Layers className="h-4 w-4 text-blue-500" />
          </div>
          <div className="text-2xl font-bold font-mono text-blue-500">
            {activeRun ? "Tracking..." : (systemStats?.live?.gpu_utilization?.[0] ? (systemStats.live.gpu_utilization[0].vram_used / 1024**3).toFixed(1) + " / " + (systemStats.live.gpu_utilization[0].vram_total / 1024**3).toFixed(0) + " GB" : "-- GB")}
          </div>
          <div className="text-xs text-zinc-400 truncate">
            {systemStats?.live?.gpu_utilization?.[0]?.name || "No GPU Detected"}
          </div>
        </div>
      </div>

      {/* Main Charts & Visualizations */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Hardware Usage Time Series */}
        <div className="lg:col-span-2 bg-[#0c0c0e] border border-zinc-800 rounded-xl p-6 space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="font-bold text-white">Hardware Telemetry Over Time</h3>
            <span className="text-xs text-zinc-400 font-mono">Sampling: 250ms</span>
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={getSpeedChartData()}>
                <defs>
                  <linearGradient id="gpuGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#06b6d4" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="cpuGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#f59e0b" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <XAxis dataKey="tick" stroke="#52525b" fontSize={10} tickLine={false} />
                <YAxis stroke="#52525b" fontSize={10} domain={[0, 100]} unit="%" tickLine={false} />
                <Tooltip 
                  contentStyle={{ backgroundColor: "#18181b", borderColor: "#27272a", borderRadius: "8px" }}
                  labelClassName="text-zinc-400 text-xs"
                />
                <Area type="monotone" dataKey="gpu0" stroke="#06b6d4" fillOpacity={1} fill="url(#gpuGrad)" name="GPU 0 Util %" />
                <Area type="monotone" dataKey="cpu" stroke="#f59e0b" fillOpacity={1} fill="url(#cpuGrad)" name="CPU Util %" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Summary side-by-side card */}
        <div className="bg-[#0c0c0e] border border-zinc-800 rounded-xl p-6 space-y-6 flex flex-col justify-between">
          <div className="space-y-4">
            <h3 className="font-bold text-white">Recent Benchmarks</h3>
            <div className="space-y-4">
              {runs.length === 0 ? (
                <div className="text-sm text-zinc-500">No benchmarks run yet.</div>
              ) : (
                runs.slice(0, 4).map((r: any) => (
                  <div key={r.id} className="flex justify-between items-center text-sm border-b border-zinc-800 pb-2">
                    <span className="text-zinc-400 truncate pr-4">{r.name}</span>
                    <span className={`font-mono font-semibold ${r.status === 'COMPLETED' ? 'text-green-500' : (r.status === 'RUNNING' ? 'text-cyan-500' : 'text-zinc-500')}`}>
                      {r.status === 'COMPLETED' && r.mean_tpot_ms ? (1000 / r.mean_tpot_ms).toFixed(1) + ' tok/s' : r.status}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
          
          {latestCompletedRun && (
            <div className="bg-transparent border border-zinc-800 rounded-lg p-4 flex gap-3 items-center">
              <Award className="h-5 w-5 text-orange-500 shrink-0" />
              <div className="text-xs space-y-0.5">
                <div className="font-semibold text-white">Latest Execution: {latestCompletedRun.name}</div>
                <p className="text-zinc-400">
                  {latestCompletedRun.mean_tpot_ms 
                    ? `Throughput: ${(1000 / latestCompletedRun.mean_tpot_ms).toFixed(1)} tok/s | Latency: ${latestCompletedRun.mean_ttft_ms?.toFixed(0)} ms`
                    : "Completed without timing data."}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Historical Benchmark Runs */}
      <div className="bg-[#0c0c0e] border border-zinc-800 rounded-xl p-6 space-y-4">
        <h3 className="font-bold text-white">Recent Experiments</h3>
        
        {loading ? (
          <div className="text-center py-8 text-zinc-400">Querying database runs...</div>
        ) : runs.length === 0 ? (
          <div className="text-center py-12 border border-dashed border-zinc-800 rounded-xl space-y-3">
            <AlertTriangle className="h-8 w-8 text-orange-500 mx-auto" />
            <div className="text-sm font-semibold text-zinc-400">No benchmark experiments found</div>
            <p className="text-xs text-zinc-400 w-full mx-auto">Launch a new benchmark run configuration to initialize comparative charts.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                <tr className="text-zinc-400 border-b border-zinc-800 font-semibold text-xs">
                  <th className="py-3 px-4">Run Name</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Model</th>
                  <th className="py-3 px-4">Progress</th>
                  <th className="py-3 px-4">Duration</th>
                  <th className="py-3 px-4">Created</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800 font-mono text-xs">
                {runs.map((r) => (
                  <tr key={r.id} className="hover:bg-[#0c0c0e]/5 transition-colors">
                    <td className="py-3 px-4 font-sans font-semibold text-white">{r.name}</td>
                    <td className="py-3 px-4">
                      <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold ${
                        r.status === "COMPLETED" ? "bg-emerald-50 text-green-500 border border-emerald-200" :
                        r.status === "RUNNING" ? "bg-[#0c0c0e] text-cyan-500 border border-zinc-800 animate-pulse" :
                        r.status === "FAILED" ? "bg-zinc-800 text-white border border-zinc-800" :
                        "bg-[#0c0c0e] text-zinc-400"
                      }`}>
                        {r.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-zinc-400">{r.config?.model?.name}</td>
                    <td className="py-3 px-4 text-zinc-400">{r.completed_requests} / {r.total_requests}</td>
                    <td className="py-3 px-4 text-zinc-400">
                      {r.duration_seconds ? `${r.duration_seconds.toFixed(1)}s` : "N/A"}
                    </td>
                    <td className="py-3 px-4 text-zinc-400">
                      {new Date(r.created_at).toLocaleString([], { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' })}
                    </td>
                    <td className="py-3 px-4 text-right space-x-2">
                      <Link 
                        href={`/benchmarks/${r.id}`}
                        className="px-2.5 py-1 text-xs border border-zinc-800 bg-[#0c0c0e] text-zinc-400 hover:text-white rounded hover:bg-zinc-900 transition-colors inline-block"
                      >
                        Inspect
                      </Link>
                      <button
                        onClick={() => handleExport(r.id, "json")}
                        className="p-1 border border-zinc-800 text-zinc-400 hover:text-white rounded hover:bg-zinc-900 transition-colors inline-block"
                        title="Download JSON Export"
                      >
                        <Download className="h-3 w-3" />
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
  );
}
