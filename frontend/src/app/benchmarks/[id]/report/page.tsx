"use client";
import React, { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Download, Printer, FileText, CheckCircle, AlertTriangle } from "lucide-react";

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
  const [telemetry, setTelemetry] = useState<any[]>([]);
  const [aiRec, setAiRec] = useState<string | null>(null);
  const [generatingRec, setGeneratingRec] = useState(false);
  const [loading, setLoading] = useState(true);


  const generateAiRecommendation = async () => {
    setGeneratingRec(true);
    try {
      const res = await fetch(`/api/runs/${id}/recommendation`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setAiRec(data.recommendation);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setGeneratingRec(false);
    }
  };

  useEffect(() => {
    const fetchReportData = async () => {
      try {
        const [runRes, reqRes, telRes] = await Promise.all([
          fetch(`/api/runs/${id}`),
          fetch(`/api/runs/${id}/results`),
          fetch(`/api/runs/${id}/telemetry`)
        ]);
        if (runRes.ok) setRun(await runRes.json());
        if (reqRes.ok) setRequests(await reqRes.json());
        if (telRes.ok) setTelemetry(await telRes.json());
      } catch (e) {
        console.error(e);
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
        setup_complexity: r.provider.setup_complexity || "unknown",
        peakGpu: 0,
        peakRam: 0,
        completed: 0,
        failed: 0,
        speeds: [] as number[],
        ttfts: [] as number[],
        qualityScores: [] as number[],
        jsonSuccess: 0,
        jsonTotal: 0,
          categories: {} as Record<string, { scores: number[] }>
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
      
      const cat = r.prompt?.category || "Uncategorized";
        if (!pstat.categories[cat]) {
          pstat.categories[cat] = { scores: [] };
        }

        r.quality_results.forEach(q => {
          if (q.evaluator_type === "json_schema") {
            pstat.jsonTotal++;
            if (q.passed) {
              pstat.jsonSuccess++;
              pstat.categories[cat].scores.push(1);
            } else {
              pstat.categories[cat].scores.push(0);
            }
          } else {
            pstat.qualityScores.push(q.score);
            pstat.categories[cat].scores.push(q.score);
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

  const exportToCSV = () => {
    if (!summary || summary.length === 0) return;
    
    let csv = "Runtime,Setup,Peak GPU (%),Peak RAM (%),Success Rate (%),Avg TTFT (ms),Speed (t/s)";
    if (evalMode !== 'standard') csv += ",Quality";
    csv += "\n";

    summary.forEach(p => {
      const successRate = p.completed + p.failed > 0 ? ((p.completed / (p.completed + p.failed)) * 100).toFixed(1) : "0";
      const quality = evalMode === 'structured_json' ? p.jsonRate.toFixed(1) : (p.meanQuality * 100).toFixed(1);
      
      let row = `"${p.name}","${p.setup_complexity}",${p.peakGpu.toFixed(1)},${p.peakRam.toFixed(1)},${successRate},${p.meanTtft.toFixed(0)},${p.meanSpeed.toFixed(1)}`;
      if (evalMode !== 'standard') row += `,${quality}`;
      
      csv += row + "\n";
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `benchlab_run_${run.id}_report.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };
  
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
        <div className="flex gap-3">
          <button 
            onClick={exportToCSV}
            className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-emerald-700 transition-colors"
          >
            <Download className="h-4 w-4" /> Export CSV
          </button>
          <button 
            onClick={() => window.print()}
            className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700 transition-colors"
          >
            <Printer className="h-4 w-4" /> Print Report
          </button>
        </div>
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
          <div><span className="font-semibold text-gray-700">Model Tested:</span> {run.config.model?.name}</div>
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
          <CheckCircle className="h-6 w-6 text-green-600" /> AI Executive Summary
        </h2>
        <div className="space-y-3 text-sm text-gray-800 leading-relaxed">
          {aiRec ? (
             <div className="p-6 bg-purple-50 border border-purple-200 rounded-xl prose prose-sm max-w-none text-purple-900" dangerouslySetInnerHTML={{__html: aiRec.replace(/\n/g, "<br/>")}}></div>
          ) : (
             <div className="flex flex-col items-center justify-center p-8 bg-gray-50 border border-gray-200 rounded-xl">
                <p className="text-gray-500 mb-4 text-center">Use your local LLM judge to analyze this benchmark data and synthesize a deployment recommendation.</p>
                <button onClick={generateAiRecommendation} disabled={generatingRec} className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded shadow disabled:opacity-50 flex items-center gap-2">
                  {generatingRec ? "Analyzing Data..." : "Generate AI Recommendation"}
                </button>
             </div>
          )}
        </div>
      </section>
      
      <section className="space-y-4 pt-6">
        <h2 className="text-2xl font-bold border-b border-gray-200 pb-2">Categorical Accuracy Breakdown</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {summary.map(p => (
            <div key={p.name} className="border border-gray-200 rounded-lg p-4 bg-gray-50">
               <h4 className="font-bold text-gray-800 mb-2">{p.name}</h4>
               <div className="space-y-2">
                 {Object.entries(p.categories).map(([cat, data]: [string, any]) => {
                   const avg = data.scores.length > 0 ? data.scores.reduce((a:number,b:number)=>a+b,0)/data.scores.length : 0;
                   return (
                     <div key={cat} className="flex justify-between items-center text-sm">
                       <span className="text-gray-600">{cat}</span>
                       <span className={`font-bold ${avg >= 0.8 ? 'text-green-600' : avg >= 0.5 ? 'text-yellow-600' : 'text-red-600'}`}>
                         {(avg * 100).toFixed(1)}%
                       </span>
                     </div>
                   );
                 })}
               </div>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-4 pt-6 page-break-before">
        <h2 className="text-2xl font-bold border-b border-gray-200 pb-2">Raw Performance Matrix</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left border border-gray-200">
            <thead className="bg-gray-100 text-gray-700">
              <tr>
                <th className="px-4 py-3 border-b">Runtime</th>
                <th className="px-4 py-3 border-b">Setup</th>
                <th className="px-4 py-3 border-b">Peak GPU / RAM</th>
                <th className="px-4 py-3 border-b">Success Rate</th>
                <th className="px-4 py-3 border-b">Avg TTFT</th>
                <th className="px-4 py-3 border-b">Speed</th>
                {evalMode !== 'standard' && <th className="px-4 py-3 border-b">Quality</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {summary.map((p) => (
                <tr key={p.name} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-semibold text-gray-900">{p.name}</td>
                  <td className="px-4 py-3 uppercase text-xs">{p.setup_complexity}</td>
                  <td className="px-4 py-3 font-mono text-xs">{p.peakGpu.toFixed(1)}% / {p.peakRam.toFixed(1)}%</td>
                  <td className="px-4 py-3">
                    <span className={p.failed > 0 ? "text-red-600" : "text-green-600"}>
                      {p.completed + p.failed > 0 ? ((p.completed / (p.completed + p.failed)) * 100).toFixed(1) : 0}%
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono">{p.meanTtft > 0 ? `${p.meanTtft.toFixed(0)} ms` : "N/A"}</td>
                  <td className="px-4 py-3 font-mono">{p.meanSpeed.toFixed(1)} t/s</td>
                  {evalMode !== 'standard' && (
                    <td className="px-4 py-3 font-mono font-semibold text-blue-600">
                      {evalMode === 'structured_json' ? `${p.jsonRate.toFixed(1)}%` : `${(p.meanQuality * 100).toFixed(1)}%`}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
