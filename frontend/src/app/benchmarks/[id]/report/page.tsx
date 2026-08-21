"use client";
import React, { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Printer, FileText, CheckCircle, AlertTriangle } from "lucide-react";

// Types mapping what we get from backend
type Provider = { id: number; name: string; type: string };
type Config = { name: string; model_name: string; temperature: number; max_tokens: number; use_identical_settings: boolean; concurrency: number };
type Run = { id: number; name: string; status: string; config: Config; hardware_info?: any; duration_seconds: number; created_at: string };
type RequestData = {
  provider: Provider;
  status: string;
  latency_ms?: number;
  ttft_ms?: number;
  output_tokens: number;
  quality_results: any[];
};

export default function ReportPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [run, setRun] = useState<Run | null>(null);
  const [requests, setRequests] = useState<RequestData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchReportData = async () => {
      try {
        const [runRes, reqsRes] = await Promise.all([
          fetch(`/api/runs/${id}`),
          fetch(`/api/runs/${id}/results`)
        ]);
        if (runRes.ok && reqsRes.ok) {
          setRun(await runRes.json());
          setRequests(await reqsRes.json());
        }
      } catch (err) {
        console.error("Failed to load report data", err);
      } finally {
        setLoading(false);
      }
    };
    fetchReportData();
  }, [id]);

  if (loading) return <div className="p-8 text-white">Generating automated report...</div>;
  if (!run) return <div className="p-8 text-red-500">Run not found.</div>;

  // Aggregate stats per provider
  const providerStats = new Map<string, any>();
  
  requests.forEach((r) => {
    if (!providerStats.has(r.provider.name)) {
      providerStats.set(r.provider.name, {
        name: r.provider.name,
        type: r.provider.type,
        completed: 0,
        failed: 0,
        speeds: [] as number[],
        ttfts: [] as number[],
        qualityScores: [] as number[],
        jsonSuccess: 0,
        jsonTotal: 0
      });
    }
    
    const pstat = providerStats.get(r.provider.name)!;
    if (r.status === "SUCCESS") {
      pstat.completed++;
      
      const latencyMs = r.latency_ms;
      const ttftMs = r.ttft_ms;
      
      if (latencyMs && r.output_tokens > 0) {
        const genTimeMs = ttftMs ? (latencyMs - ttftMs) : latencyMs;
        const genSec = genTimeMs / 1000.0;
        if (genSec > 0) pstat.speeds.push(r.output_tokens / genSec);
      }
      
      if (ttftMs) pstat.ttfts.push(ttftMs);
      
      r.quality_results.forEach(q => {
        if (q.evaluator_type === "json_schema") {
          pstat.jsonTotal++;
          if (q.passed) pstat.jsonSuccess++;
        } else {
          pstat.qualityScores.push(q.score);
        }
      });
      
    } else {
      pstat.failed++;
    }
  });

  const summary = Array.from(providerStats.values()).map(p => {
    return {
      ...p,
      meanSpeed: p.speeds.length > 0 ? p.speeds.reduce((a: number, b: number) => a + b, 0) / p.speeds.length : 0,
      meanTtft: p.ttfts.length > 0 ? p.ttfts.reduce((a: number, b: number) => a + b, 0) / p.ttfts.length : 0,
      meanQuality: p.qualityScores.length > 0 ? p.qualityScores.reduce((a: number, b: number) => a + b, 0) / p.qualityScores.length : 0,
      jsonRate: p.jsonTotal > 0 ? (p.jsonSuccess / p.jsonTotal) * 100 : 0
    };
  });

  const fastestSpeed = [...summary].sort((a, b) => b.meanSpeed - a.meanSpeed)[0];
  const lowestTtft = [...summary].filter(s => s.meanTtft > 0).sort((a, b) => a.meanTtft - b.meanTtft)[0];
  const highestQuality = [...summary].sort((a, b) => b.meanQuality - a.meanQuality)[0];

  const evalMode = run.hardware_info?.benchmark_mode || "standard";
  
  return (
    <div className="max-w-4xl mx-auto bg-white min-h-screen text-black shadow-xl my-8 print:my-0 print:shadow-none p-12 space-y-8 rounded-xl print:rounded-none">
      {/* Print Controls */}
      <div className="flex justify-between items-center pb-6 border-b border-gray-200 print:hidden">
        <button 
          onClick={() => router.back()}
          className="flex items-center gap-2 text-gray-500 hover:text-gray-900 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Dashboard
        </button>
        <button 
          onClick={() => window.print()}
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700"
        >
          <Printer className="h-4 w-4" /> Print Report
        </button>
      </div>

      <div className="space-y-2 text-center pb-8">
        <h1 className="text-4xl font-extrabold tracking-tight text-gray-900">BenchLab Execution Report</h1>
        <p className="text-gray-500 text-lg">{run.name} — Generated on {new Date().toLocaleDateString()}</p>
      </div>

      <section className="space-y-4">
        <h2 className="text-2xl font-bold border-b border-gray-200 pb-2 flex items-center gap-2">
          <FileText className="h-6 w-6 text-blue-600" /> Methodology & Configuration
        </h2>
        <div className="bg-gray-50 p-6 rounded-xl border border-gray-200 text-sm grid grid-cols-2 gap-4">
          <div><span className="font-semibold text-gray-700">Model Tested:</span> {run.config.model_name}</div>
          <div><span className="font-semibold text-gray-700">Concurrency:</span> {run.config.concurrency} parallel streams</div>
          <div><span className="font-semibold text-gray-700">Temperature:</span> {run.config.temperature}</div>
          <div><span className="font-semibold text-gray-700">Evaluation Strategy:</span> {evalMode.toUpperCase()}</div>
          <div><span className="font-semibold text-gray-700">Total Duration:</span> {run.duration_seconds.toFixed(1)}s</div>
          <div><span className="font-semibold text-gray-700">Identical Workload:</span> {run.config.use_identical_settings ? "Yes (Strict Parity)" : "No"}</div>
          {run.hardware_info?.custom_hardware_profile && (
            <div className="col-span-2"><span className="font-semibold text-gray-700">Hardware Profile:</span> {run.hardware_info.custom_hardware_profile}</div>
          )}
        </div>
        <p className="text-sm text-gray-600 leading-relaxed">
          This test isolates engine performance by forcing the same exact workload (prompts, hyperparameters, concurrency limits) through multiple backend LLM runtimes. Time-To-First-Token (TTFT) measures compute-bound prompt prefill capability, while Generation Speed (TPOT inverse) measures memory bandwidth-bound decode speed.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-bold border-b border-gray-200 pb-2 flex items-center gap-2">
          <CheckCircle className="h-6 w-6 text-green-600" /> Executive Summary & Recommendations
        </h2>
        <div className="space-y-3 text-sm text-gray-800 leading-relaxed">
          <p>
            Based on the benchmark data, <strong>{fastestSpeed?.name}</strong> provided the highest decode throughput at <strong>{fastestSpeed?.meanSpeed.toFixed(1)} tokens/sec</strong>.
          </p>
          {lowestTtft && (
            <p>
              For latency-sensitive applications (like chatbots), <strong>{lowestTtft.name}</strong> delivered the fastest Time-To-First-Token prefill phase averaging <strong>{lowestTtft.meanTtft.toFixed(0)} ms</strong>.
            </p>
          )}
          {evalMode === "structured_json" && (
            <p>
              <strong>JSON Reliability:</strong> 
              {summary.map(s => ` ${s.name} scored ${s.jsonRate.toFixed(0)}%.`).join("")}
            </p>
          )}
          
          <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <h4 className="font-bold text-blue-900 mb-2">Deployment Recommendation</h4>
            <p className="text-blue-800">
              For <strong>Local Development</strong>, tools with low setup overhead (like Ollama) are recommended unless large context windows cause severe TTFT spikes. <br/>
              For <strong>Production Deployments</strong>, a highly optimized runtime like <strong>{fastestSpeed?.name}</strong> should be leveraged to maximize hardware saturation and Token/s throughput, especially under high concurrency.
            </p>
          </div>
        </div>
      </section>

      <section className="space-y-4 pt-6 page-break-before">
        <h2 className="text-2xl font-bold border-b border-gray-200 pb-2">Raw Performance Matrix</h2>
        <table className="w-full text-sm text-left border border-gray-200">
          <thead className="bg-gray-100 text-gray-700">
            <tr>
              <th className="px-4 py-3 border-b">Runtime / Provider</th>
              <th className="px-4 py-3 border-b">Success Rate</th>
              <th className="px-4 py-3 border-b">Avg TTFT (Prefill)</th>
              <th className="px-4 py-3 border-b">Speed (Decode)</th>
              {evalMode !== 'standard' && <th className="px-4 py-3 border-b">Quality / JSON %</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {summary.map((p) => (
              <tr key={p.name} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-semibold text-gray-900">{p.name}</td>
                <td className="px-4 py-3">
                  <span className={p.failed > 0 ? "text-red-600" : "text-green-600"}>
                    {((p.completed / (p.completed + p.failed)) * 100).toFixed(1)}%
                  </span>
                </td>
                <td className="px-4 py-3 font-mono">{p.meanTtft > 0 ? `${p.meanTtft.toFixed(0)} ms` : "N/A"}</td>
                <td className="px-4 py-3 font-mono">{p.meanSpeed.toFixed(1)} t/s</td>
                {evalMode !== 'standard' && (
                  <td className="px-4 py-3 font-mono font-semibold text-blue-600">
                    {evalMode === 'structured_json' ? `${p.jsonRate.toFixed(1)}%` : `${(p.meanQuality * 10).toFixed(1)}/10`}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      
      <section className="space-y-4 pt-6">
        <h2 className="text-2xl font-bold border-b border-gray-200 pb-2 flex items-center gap-2">
          <AlertTriangle className="h-6 w-6 text-amber-500" /> Known Benchmark Limitations
        </h2>
        <ul className="list-disc pl-5 text-sm text-gray-600 space-y-2">
          <li><strong>Network Overhead:</strong> Remote API providers (OpenAI, Together) include network transit latency in TTFT measurements, which disadvantages them compared to local loopback APIs like vLLM.</li>
          <li><strong>Quantization Discrepancies:</strong> If identical model weights were not forced, one runtime may be serving a lower-precision quant (e.g., Q4) while another serves FP16, heavily skewing decode speeds.</li>
          <li><strong>Hardware Saturation:</strong> Runtimes have different maximum batch sizes. Under extreme concurrency, engines like vLLM pull significantly ahead of local developer tools, which may not be visible in single-stream tests.</li>
        </ul>
      </section>
      
    </div>
  );
}
