"use client";

import React, { useState, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { 
  Play, 
  Square, 
  Activity, 
  Cpu, 
  CheckCircle, 
  XCircle, 
  Clock, 
  TrendingUp, 
  AlertTriangle,
  Download, FileText,
  Award
} from "lucide-react";
import { 
  ResponsiveContainer, 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  Tooltip, 
  BarChart, 
  Bar, 
  Legend 
} from "recharts";

const API_BASE = "";

interface RequestLog {
  id: number;
  provider: { id: number; name: string; type: string };
  model_name: string;
  request_index: number;
  status: string;
  latency_ms?: number;
  ttft_ms?: number;
  start_time?: number;
  first_token_time?: number;
  finish_time?: number;
  prompt_tokens: number;
  output_tokens: number;
  token_count_source: string;
  response_text?: string;
  error_message?: string;
  quality_results: any[];
}

export default function BenchmarkDetails() {
  const { id } = useParams();
  const router = useRouter();
  const [run, setRun] = useState<any>(null);
  const [requests, setRequests] = useState<RequestLog[]>([]);
  const [telemetry, setTelemetry] = useState<any[]>([]);
  const [liveStreamText, setLiveStreamText] = useState<string>("");
  const [activeSpeedMeter, setActiveSpeedMeter] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [stopping, setStopping] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const terminalRef = useRef<HTMLDivElement>(null);

  const [termOllama, setTermOllama] = useState("");
  const [termLlamaCpp, setTermLlamaCpp] = useState("");
  const [termBackend, setTermBackend] = useState("");
  const [termVllm, setTermVllm] = useState("");
  const [termTransformers, setTermTransformers] = useState("");

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (run) {
      interval = setInterval(async () => {
        try {
          const res1 = await fetch(`${API_BASE}/api/terminal/ollama`);
          if (res1.ok) setTermOllama((await res1.json()).log);

          const res2 = await fetch(`${API_BASE}/api/terminal/llamacpp`);
          if (res2.ok) setTermLlamaCpp((await res2.json()).log);

          const res3 = await fetch(`${API_BASE}/api/terminal/backend`);
          if (res3.ok) setTermBackend((await res3.json()).log);
          
          const res4 = await fetch(`${API_BASE}/api/terminal/vllm`);
          if (res4.ok) setTermVllm((await res4.json()).log);

          const res5 = await fetch(`${API_BASE}/api/terminal/transformers`);
          if (res5.ok) setTermTransformers((await res5.json()).log);
        } catch(e) {}
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [run]);

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [requests]);

  const fetchStaticData = async () => {
    try {
      const runRes = await fetch(`${API_BASE}/api/runs/${id}`);
      if (!runRes.ok) return;
      const runData = await runRes.json();
      setRun(runData);

      const resultsRes = await fetch(`${API_BASE}/api/runs/${id}/results`);
      const resultsData = await resultsRes.json();
      setRequests(resultsData);

      const telRes = await fetch(`${API_BASE}/api/runs/${id}/telemetry`);
      const telData = await telRes.json();
      setTelemetry(telData);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStaticData();
    
    // Connect to SSE for live updates
    const eventSource = new EventSource(`${API_BASE}/api/events`);
    eventSourceRef.current = eventSource;

    eventSource.addEventListener("telemetry_update", (e: any) => {
      const data = JSON.parse(e.data);
      if (Number(data.run_id) === Number(id)) {
        setTelemetry(prev => {
          const next = [...prev, data];
          return next.slice(-40); // Keep last 40 frames
        });
      }
    });

    const updateRequestInState = (reqData: any) => {
      fetchStaticData(); // Re-fetch all request objects to update charts cleanly
    };

    eventSource.addEventListener("request_started", (e: any) => updateRequestInState(JSON.parse(e.data)));
    eventSource.addEventListener("first_token", (e: any) => updateRequestInState(JSON.parse(e.data)));
    eventSource.addEventListener("request_completed", (e: any) => updateRequestInState(JSON.parse(e.data)));
    eventSource.addEventListener("request_failed", (e: any) => updateRequestInState(JSON.parse(e.data)));
    eventSource.addEventListener("benchmark_completed", (e: any) => {
      fetchStaticData();
    });

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, [id]);

  const handleStop = async () => {
    setStopping(true);
    try {
      await fetch(`${API_BASE}/api/runs/${id}/stop`, { method: "POST" });
      fetchStaticData();
    } catch (err) {
      console.error(err);
    } finally {
      setStopping(false);
    }
  };

  // Group metrics calculations per provider
  const getProviderAggregates = () => {
    const stats: Record<string, {
      name: string;
      type: string;
      total: number;
      completed: number;
      failed: number;
      speeds: number[];
      ttfts: number[];
      latencies: number[];
      qualityScores: number[];
      jsonTotal: number;
      jsonSuccess: number;
      estimatedTokens: boolean;
      errors: string[];
    }> = {};

    requests.forEach(r => {
      const name = `${r.provider.name} (${r.model_name})`;
      if (!stats[name]) {
        stats[name] = {
          name,
          type: r.provider.type,
          total: 0,
          completed: 0,
          failed: 0,
          speeds: [],
          ttfts: [],
          latencies: [],
          qualityScores: [],
          jsonTotal: 0,
          jsonSuccess: 0,
          estimatedTokens: false,
          errors: []
        };
      }

      const pstat = stats[name];
      pstat.total += 1;
      
      if (r.status === "SUCCESS") {
        pstat.completed += 1;
        if (r.token_count_source === "tokenizer" || r.token_count_source === "estimated") {
          pstat.estimatedTokens = true;
        }

        const latencyMs = r.latency_ms ?? (r.finish_time && r.start_time ? (r.finish_time - r.start_time) / 1000.0 : null);
        const ttftMs = r.ttft_ms ?? (r.first_token_time && r.start_time ? (r.first_token_time - r.start_time) / 1000.0 : null);

        // speed calculation
        if (latencyMs && r.output_tokens > 0) {
          const genTimeMs = ttftMs ? (latencyMs - ttftMs) : latencyMs;
          const genSec = genTimeMs / 1000.0;
          if (genSec > 0) {
            pstat.speeds.push(r.output_tokens / genSec);
          }
        }

        if (ttftMs) pstat.ttfts.push(ttftMs);
        if (latencyMs) pstat.latencies.push(latencyMs);

        r.quality_results.forEach(q => {
          pstat.qualityScores.push(q.score * 100.0);
          if (q.evaluator_type === "json_schema") {
            pstat.jsonTotal += 1;
            if (q.passed) pstat.jsonSuccess += 1;
          }
        });
      } else if (r.status === "FAILED") {
        pstat.failed += 1;
        if (r.error_message) pstat.errors.push(r.error_message);
      }
    });

    return Object.values(stats);
  };

  const providerSummary = getProviderAggregates();
  const isRunning = run?.status === "RUNNING" || run?.status === "PENDING";
  const progressPct = run?.total_requests ? Math.round((run.completed_requests + run.failed_requests) / run.total_requests * 100) : 0;

  // Chart data formatting
  const getTelemetryData = () => {
    return telemetry.map((t, idx) => ({
      tick: idx,
      cpu: parseFloat(t.cpu_utilization.toFixed(1)),
      ram: parseFloat(((t.ram_used_bytes / t.ram_total_bytes) * 100.0).toFixed(1)),
      gpu0: parseFloat((t.gpu_utilization?.[0]?.utilization || 0).toFixed(1)),
      gpu1: parseFloat((t.gpu_utilization?.[1]?.utilization || 0).toFixed(1))
    }));
  };

  return (
    <div className="flex flex-col gap-2 flex-1 h-full overflow-hidden">
      {/* Top Details Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <div className="flex items-center gap-3">
            <span className={`px-2.5 py-0.5 rounded text-xs uppercase font-bold border ${
              run?.status === "COMPLETED" ? "bg-zinc-900 text-zinc-100 border-zinc-500" :
              isRunning ? "bg-[#0c0c0e] text-white border-zinc-800 animate-pulse" :
              run?.status === "STOPPED" ? "bg-[#0c0c0e] text-zinc-400 border-zinc-800" :
              "bg-zinc-800 text-white border-zinc-800"
            }`}>
              {run?.status}
            </span>
            <span className="text-zinc-400 text-xs font-mono">Run ID: {id}</span>
          </div>
          <h1 className="text-lg font-bold mt-0.5 text-white">{run?.name}</h1>
          <p className="text-sm text-zinc-400 mt-1 font-mono">
            Model: {run?.config?.model?.name} | Concurrency: {run?.config?.concurrency} | Repetitions: {run?.config?.repetitions}
          </p>
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => router.push(`/benchmarks/${id}/report`)}
            className="flex items-center gap-2 px-2 py-1 bg-zinc-900 text-zinc-300 border border-zinc-500 hover:bg-zinc-900 font-bold rounded-lg text-sm transition-colors"
          >
            <FileText className="h-4 w-4" />
            Generate Report
          </button>
          {isRunning && (
            <button
              onClick={handleStop}
              disabled={stopping}
              className="flex items-center gap-2 px-2 py-1 bg-zinc-800 hover:bg-zinc-800 font-bold rounded-lg text-sm transition-colors"
            >
              <Square className="h-4 w-4 fill-white" />
              {stopping ? "Stopping..." : "Stop Execution"}
            </button>
          )}
          <button
            onClick={() => window.open(`${API_BASE}/api/runs/${id}/results`)}
            className="flex items-center gap-2 px-3 py-1.5 border border-zinc-800 rounded-lg text-sm bg-black text-zinc-400 hover:bg-zinc-900 transition-colors"
          >
            <Download className="h-4 w-4" />
            Raw Data (JSON)
          </button>
        </div>
      </div>

      <div className="flex flex-col xl:flex-row gap-2 flex-1 overflow-hidden">
        <div className="w-full xl:w-[70%] flex flex-col gap-4 overflow-hidden">
{/* Progress Bar (Overall) */}
      {isRunning && (
        <div className="bg-[#0c0c0e] border border-zinc-800 rounded-xl p-2 space-y-1">
          <div className="flex justify-between items-center text-xs text-zinc-400 font-mono">
            <span>Overall Progress</span>
            <span>{progressPct}% ({run?.completed_requests + run?.failed_requests} / {run?.total_requests} requests)</span>
          </div>
          <div className="w-full bg-black h-1.5 rounded-full overflow-hidden border border-zinc-800">
            <div className="bg-white text-black text-zinc-950 shadow-sm border-0 font-medium h-full transition-all duration-300" style={{ width: `${progressPct}%` }} />
          </div>
        </div>
      )}

      {/* Runtime Performance Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 overflow-y-auto min-h-[80px]">
        {providerSummary.map((p) => {
          const meanSpeed = p.speeds.length > 0 ? (p.speeds.reduce((a, b) => a + b, 0) / p.speeds.length) : 0;
          const meanTtft = p.ttfts.length > 0 ? (p.ttfts.reduce((a, b) => a + b, 0) / p.ttfts.length) : null;
          const meanQuality = p.qualityScores.length > 0 ? (p.qualityScores.reduce((a, b) => a + b, 0) / p.qualityScores.length) : 0;
          const jsonRate = p.jsonTotal > 0 ? (p.jsonSuccess / p.jsonTotal * 100) : null;

          return (
            <div key={p.name} className="bg-[#0c0c0e] border border-zinc-800 rounded-xl p-2 space-y-1 flex flex-col justify-between">
              <div className="space-y-3">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-bold text-white">{p.name}</h3>
                    <span className="text-[10px] bg-[#0c0c0e] text-zinc-400 font-mono px-2 py-0.5 rounded uppercase mt-1 inline-block">
                      {p.type}
                    </span>
                  </div>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                    p.completed === p.total && p.total > 0 ? "bg-zinc-900 text-zinc-100 border border-zinc-500" :
                    p.failed === p.total && p.total > 0 ? "bg-zinc-800 text-white border border-zinc-800" :
                    "bg-[#0c0c0e] text-white border border-zinc-800 animate-pulse"
                  }`}>
                    {p.completed === p.total ? "Done" : "Benchmarking"}
                  </span>
                </div>

                                {/* Primary Stats & Live Speedometer */}
                <div className="grid grid-cols-2 gap-2 py-1 border-y border-zinc-800">
                  <div className="relative overflow-hidden bg-black/40 border border-zinc-800/80 rounded-lg p-2 flex flex-col justify-between">
                    <div className="flex justify-between items-center">
                      <span className="text-[9px] text-zinc-400 font-bold uppercase tracking-wider">Serving Speed</span>
                      {isRunning && <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse"></span>}
                    </div>
                    <div className="text-sm font-bold font-mono text-zinc-100 mt-0.5">
                      {meanSpeed > 0 ? `${meanSpeed.toFixed(1)} t/s` : "Pending"}
                    </div>
                    {/* Live Speed Bar */}
                    <div className="w-full bg-zinc-800 h-1 rounded-full overflow-hidden mt-1">
                      <div 
                        className="bg-white h-full transition-all duration-300 rounded-full" 
                        style={{ width: `${Math.min(100, (meanSpeed / 100) * 100)}%` }}
                      />
                    </div>
                  </div>
                  <div className="bg-black/40 border border-zinc-800/80 rounded-lg p-2 flex flex-col justify-between">
                    <div className="text-[9px] text-zinc-400 font-bold uppercase tracking-wider">Time to First Token</div>
                    <div className="text-sm font-bold font-mono text-zinc-300 mt-0.5">
                      {meanTtft ? `${meanTtft.toFixed(0)} ms` : "N/A"}
                    </div>
                    <div className="text-[9px] text-zinc-500 font-mono">
                      {p.completed} / {p.total} done
                    </div>
                  </div>
                </div>


                {/* Second Row Quality & JSON */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-[10px] text-zinc-400 font-bold uppercase">Eval Quality</div>
                    <div className="text-xs font-semibold font-mono text-zinc-400 mt-0.5">
                      {meanQuality > 0 ? `${meanQuality.toFixed(1)}%` : "N/A"}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-zinc-400 font-bold uppercase">JSON schema</div>
                    <div className="text-xs font-semibold font-mono text-zinc-400 mt-0.5">
                      {jsonRate !== null ? `${jsonRate.toFixed(1)}%` : "N/A"}
                    </div>
                  </div>
                </div>
              </div>

              {/* Informative Limitations (Important for fair benchmark) */}
              <div className="space-y-1.5 pt-1 border-t border-zinc-800/80">
                {meanTtft === null && p.completed > 0 && (
                  <div className="text-[10px] text-zinc-400 flex items-center gap-1">
                    <AlertTriangle className="h-1.5 w-3" />
                    TTFT unavailable (Streaming not supported)
                  </div>
                )}
                {p.estimatedTokens && (
                  <div className="text-[10px] text-zinc-400">
                    * Token count estimated with tokenizer.
                  </div>
                )}
                {p.failed > 0 && (
                  <div 
                    className="text-[10px] text-white line-clamp-3 whitespace-pre-wrap break-words" 
                    title={p.errors[0]}
                  >
                    Error: {p.errors[0]}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Telemetry and Request Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 flex-1 overflow-hidden">
        {/* Dynamic Telemetry Chart */}
        <div className="bg-[#0c0c0e] border border-zinc-800 rounded-xl p-2 flex flex-col gap-1 h-full overflow-hidden">
          <h3 className="font-bold text-white">Hardware Telemetry</h3>
          <div className="flex-1 min-h-0">
            {telemetry.length === 0 ? (
              <div className="text-center text-zinc-500 text-xs py-24">No telemetry frames recorded yet.</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={getTelemetryData()}>
                  <XAxis dataKey="tick" stroke="#52525b" fontSize={10} tickLine={false} />
                  <YAxis stroke="#52525b" fontSize={10} domain={[0, 100]} unit="%" tickLine={false} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: "#18181b", borderColor: "#27272a", borderRadius: "8px" }}
                    labelClassName="text-zinc-400 text-xs"
                  />
                  <Legend verticalAlign="top" height={36} wrapperStyle={{ fontSize: "10px" }} />
                  <Line type="monotone" dataKey="gpu0" stroke="#06b6d4" strokeWidth={1.5} name="GPU 0 Util %" dot={false} />
                  <Line type="monotone" dataKey="cpu" stroke="#f59e0b" strokeWidth={1.5} name="CPU Util %" dot={false} />
                  <Line type="monotone" dataKey="ram" stroke="#a755f7" strokeWidth={1.5} name="RAM %" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Latency Comparison Chart */}
        <div className="bg-[#0c0c0e] border border-zinc-800 rounded-xl p-2 flex flex-col gap-1 h-full overflow-hidden">
          <h3 className="font-bold text-white">Throughput vs Latency</h3>
          <div className="flex-1 min-h-0">
            {requests.length === 0 ? (
              <div className="text-center text-zinc-500 text-xs py-24">Awaiting completed request metrics...</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={providerSummary}>
                  <XAxis dataKey="name" stroke="#52525b" fontSize={10} tickLine={false} />
                  <YAxis yAxisId="left" stroke="#52525b" fontSize={10} tickLine={false} unit=" t/s" />
                  <YAxis yAxisId="right" orientation="right" stroke="#52525b" fontSize={10} tickLine={false} unit=" ms" />
                  <Tooltip 
                    contentStyle={{ backgroundColor: "#18181b", borderColor: "#27272a", borderRadius: "8px" }}
                    labelClassName="text-zinc-400 text-xs"
                  />
                  <Legend verticalAlign="top" height={36} wrapperStyle={{ fontSize: "10px" }} />
                  <Bar yAxisId="left" dataKey="speeds" fill="#10b981" name="Mean speed (tok/s)" />
                  <Bar yAxisId="right" dataKey="latencies" fill="#3b82f6" name="Mean latency (ms)" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* Raw request-level logging */}
      <div className="bg-[#0c0c0e] border border-zinc-800 rounded-xl p-2 flex flex-col gap-1 h-full overflow-hidden">
        <h3 className="font-bold text-white">Request Logs</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm border-collapse">
            <thead>
              <tr className="text-zinc-400 border-b border-zinc-800 font-semibold text-xs">
                <th className="py-2.5 px-4">Index</th>
                <th className="py-2.5 px-4">Provider</th>
                <th className="py-2.5 px-4">Status</th>
                <th className="py-2.5 px-4">Latency (ms)</th>
                <th className="py-2.5 px-4">TTFT</th>
                <th className="py-2.5 px-4">Speed</th>
                <th className="py-2.5 px-4">Prompt Tokens</th>
                <th className="py-2.5 px-4">Output Tokens</th>
                <th className="py-2.5 px-4">Quality Score</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800 font-mono text-xs text-zinc-400">
              {requests.map((r, idx) => {
                const latencyMs = r.latency_ms ?? (r.finish_time && r.start_time ? (r.finish_time - r.start_time) / 1000.0 : null);
                const ttftMs = r.ttft_ms ?? (r.first_token_time && r.start_time ? (r.first_token_time - r.start_time) / 1000.0 : null);

                const latency = latencyMs ? `${latencyMs.toFixed(0)} ms` : "N/A";
                const ttft = ttftMs ? `${ttftMs.toFixed(0)} ms` : "N/A";
                
                let speedVal = 0;
                if (latencyMs && r.output_tokens > 0) {
                  const genTimeMs = ttftMs ? (latencyMs - ttftMs) : latencyMs;
                  const genSec = genTimeMs / 1000.0;
                  if (genSec > 0) {
                    speedVal = r.output_tokens / genSec;
                  }
                }
                
                const speed = speedVal > 0 ? `${speedVal.toFixed(1)} t/s` : "N/A";
                const qScore = r.quality_results?.[0] ? `${(r.quality_results[0].score * 100).toFixed(0)}%` : "N/A";

                return (
                  <tr key={idx} className="hover:bg-[#0c0c0e]/5 transition-colors">
                    <td className="py-2 px-4 text-zinc-400">{r.request_index}</td>
                    <td className="py-2 px-4 font-sans font-semibold text-white">{r.provider.name}</td>
                    <td className="py-2 px-4">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                        r.status === "SUCCESS" ? "bg-zinc-900 text-zinc-100 border border-zinc-500" :
                        r.status === "RUNNING" ? "bg-[#0c0c0e] text-white border border-zinc-800 animate-pulse" :
                        "bg-zinc-800 text-white border-zinc-800"
                      }`}>
                        {r.status}
                      </span>
                    </td>
                    <td className="py-2 px-4">{latency}</td>
                    <td className="py-2 px-4">{ttft}</td>
                    <td className="py-2 px-4">{speed}</td>
                    <td className="py-2 px-4 text-zinc-400">{r.prompt_tokens}</td>
                    <td className="py-2 px-4 text-zinc-400">{r.output_tokens}</td>
                    <td className="py-2 px-4 text-white">{qScore}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
        </div>
        <div className="w-full xl:w-[30%] flex flex-col gap-2 overflow-hidden">
{/* Real-time Hardware Terminals */}
      {(() => {
        const hasLlamaCpp = providerSummary.some(p => p.type === "llamacpp");
        const hasOllama = providerSummary.some(p => p.name.toLowerCase().includes("ollama"));
        const hasVllm = providerSummary.some(p => p.type === "vllm");
        const hasTransformers = providerSummary.some(p => p.type === "transformers");
        const termCount = 1 + (hasLlamaCpp ? 1 : 0) + (hasOllama ? 1 : 0) + (hasVllm ? 1 : 0) + (hasTransformers ? 1 : 0);
        const gridClass = termCount === 1 ? "grid-cols-1" :
                          termCount === 2 ? "grid-cols-1 md:grid-cols-2" :
                          termCount === 3 ? "grid-cols-1 md:grid-cols-3" :
                          "grid-cols-1 md:grid-cols-2 xl:grid-cols-4";

        return (
          <>
            <h3 className="font-bold text-white mb-2">Live Engine Terminals</h3>
          <div className="flex flex-col gap-2 flex-1 overflow-y-auto pr-2">
            
            {/* Backend Terminal */}
            <div className="bg-[#050505] border border-zinc-800 rounded-xl overflow-hidden flex flex-col flex-1 min-h-[100px] shadow-2xl">
              <div className="bg-zinc-900 px-2 py-1 flex items-center gap-2 border-b border-zinc-800 shadow-md z-10">
                <div className="flex gap-1.5">
                  <div className="w-3 h-1.5 rounded-full bg-zinc-800"></div>
                  <div className="w-3 h-1.5 rounded-full bg-zinc-800"></div>
                  <div className="w-3 h-1.5 rounded-full bg-zinc-400"></div>
                </div>
                <span className="text-xs font-mono text-zinc-400 ml-2">FastAPI Backend (Engine)</span>
              </div>
              <div className="p-2 overflow-y-auto flex-1 font-mono text-[10px] space-y-1 scroll-smooth text-zinc-300 break-all whitespace-pre-wrap flex flex-col-reverse">
                {termBackend || "Connecting to stream..."}
              </div>
            </div>

            {/* Llama.cpp Terminal */}
            {hasLlamaCpp && (
              <div className="bg-[#050505] border border-zinc-800 rounded-xl overflow-hidden flex flex-col flex-1 min-h-[100px] shadow-2xl">
                <div className="bg-zinc-900 px-2 py-1 flex items-center gap-2 border-b border-zinc-800 shadow-md z-10">
                  <div className="flex gap-1.5">
                    <div className="w-3 h-1.5 rounded-full bg-zinc-800"></div>
                    <div className="w-3 h-1.5 rounded-full bg-zinc-800"></div>
                    <div className="w-3 h-1.5 rounded-full bg-zinc-400"></div>
                  </div>
                  <span className="text-xs font-mono text-zinc-400 ml-2">llama.cpp Engine</span>
                </div>
                <div className="p-2 overflow-y-auto flex-1 font-mono text-[10px] space-y-1 scroll-smooth text-zinc-100 break-all whitespace-pre-wrap flex flex-col-reverse">
                  {termLlamaCpp || "Connecting to stream..."}
                </div>
              </div>
            )}

            {/* Transformers Terminal */}
            {hasTransformers && (
              <div className="bg-[#050505] border border-zinc-800 rounded-xl overflow-hidden flex flex-col flex-1 min-h-[100px] shadow-2xl">
                <div className="bg-zinc-900 px-2 py-1 flex items-center gap-2 border-b border-zinc-800 shadow-md z-10">
                  <div className="flex gap-1.5">
                    <div className="w-3 h-1.5 rounded-full bg-zinc-800"></div>
                    <div className="w-3 h-1.5 rounded-full bg-zinc-800"></div>
                    <div className="w-3 h-1.5 rounded-full bg-zinc-400"></div>
                  </div>
                  <span className="text-xs font-mono text-zinc-400 ml-2">Hugging Face Transformers</span>
                </div>
                <div className="p-2 overflow-y-auto flex-1 font-mono text-[10px] space-y-1 scroll-smooth text-zinc-300 break-all whitespace-pre-wrap flex flex-col-reverse">
                  {termTransformers || "Connecting to stream..."}
                </div>
              </div>
            )}

            {/* Ollama Terminal */}
            {hasOllama && (
              <div className="bg-[#050505] border border-zinc-800 rounded-xl overflow-hidden flex flex-col flex-1 min-h-[100px] shadow-2xl">
                <div className="bg-zinc-900 px-2 py-1 flex items-center gap-2 border-b border-zinc-800 shadow-md z-10">
                  <div className="flex gap-1.5">
                    <div className="w-3 h-1.5 rounded-full bg-zinc-800"></div>
                    <div className="w-3 h-1.5 rounded-full bg-zinc-800"></div>
                    <div className="w-3 h-1.5 rounded-full bg-zinc-400"></div>
                  </div>
                  <span className="text-xs font-mono text-zinc-400 ml-2">Ollama Engine</span>
                </div>
                <div className="p-2 overflow-y-auto flex-1 font-mono text-[10px] space-y-1 scroll-smooth text-white break-all whitespace-pre-wrap flex flex-col-reverse">
                  {termOllama || "Connecting to stream..."}
                </div>
              </div>
            )}

            {/* vLLM Terminal */}
            {hasVllm && (
              <div className="bg-[#050505] border border-zinc-800 rounded-xl overflow-hidden flex flex-col flex-1 min-h-[100px] shadow-2xl">
                <div className="bg-zinc-900 px-2 py-1 flex items-center gap-2 border-b border-zinc-800 shadow-md z-10">
                  <div className="flex gap-1.5">
                    <div className="w-3 h-1.5 rounded-full bg-zinc-800"></div>
                    <div className="w-3 h-1.5 rounded-full bg-zinc-800"></div>
                    <div className="w-3 h-1.5 rounded-full bg-zinc-400"></div>
                  </div>
                  <span className="text-xs font-mono text-zinc-400 ml-2">vLLM Engine</span>
                </div>
                <div className="p-2 overflow-y-auto flex-1 font-mono text-[10px] space-y-1 scroll-smooth text-zinc-300 break-all whitespace-pre-wrap flex flex-col-reverse">
                  {termVllm || "Connecting to stream..."}
                </div>
              </div>
            )}

          </div>
          </>
        );
      })()}

              </div>
      </div>
    </div>
  );
}
