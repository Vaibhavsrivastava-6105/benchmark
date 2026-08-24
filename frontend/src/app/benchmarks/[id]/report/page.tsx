"use client";
import React, { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Download, Printer, FileText, CheckCircle, AlertTriangle } from "lucide-react";

// Types mapping what we get from backend
type Provider = { id: number; name: string; type: string; setup_complexity?: string; process_telemetry?: any };
type Config = { name: string; model_name?: string; model?: { name: string; quantization?: string }; temperature: number; max_tokens: number; use_identical_settings: boolean; concurrency: number };
type Run = { id: number; name: string; status: string; config: Config; hardware_info?: any; duration_seconds: number; created_at: string };
type RequestData = {
  provider: Provider;
  status: string;
  latency_ms?: number;
  ttft_ms?: number;
  output_tokens: number;
  quality_results: any[];
  prompt?: any;
  model_name?: string;
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
  const [failureData, setFailureData] = useState<any>(null);
  const [selectedFailureCat, setSelectedFailureCat] = useState<string>("ALL");
  const [expandedFailureId, setExpandedFailureId] = useState<number | null>(null);
  const [allRequests, setAllRequests] = useState<any[]>([]);
  const [humanEvals, setHumanEvals] = useState<any>(null);
  const [selectedHumanFilter, setSelectedHumanFilter] = useState<string>("ALL");
  const [activeRequestForEval, setActiveRequestForEval] = useState<any>(null);
  const [evalFeedback, setEvalFeedback] = useState("");

  const submitHumanEval = async (requestId: number, rating: string) => {
    try {
      const res = await fetch("/api/evaluations/human", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          request_id: requestId,
          human_rating: rating,
          human_feedback: evalFeedback || null
        })
      });
      if (res.ok) {
        setAllRequests(prev => prev.map(r => r.request_id === requestId ? { ...r, human_rating: rating, human_feedback: evalFeedback } : r));
        setActiveRequestForEval(null);
        setEvalFeedback("");
        fetch(`/api/benchmarks/${id}/human-eval`).then(r => r.ok ? r.json() : null).then(d => {
          if (d) setHumanEvals(d);
        }).catch(console.error);
      }
    } catch (e) {
      console.error("Failed to submit human evaluation:", e);
    }
  };


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
        fetch(`/api/benchmarks/${id}/failures`).then(r => r.ok ? r.json() : null).then(d => {
          if (d) setFailureData(d);
        }).catch(console.error);
        fetch(`/api/benchmarks/${id}/requests`).then(r => r.ok ? r.json() : null).then(d => {
          if (d) setAllRequests(d.requests);
        }).catch(console.error);
        fetch(`/api/benchmarks/${id}/human-eval`).then(r => r.ok ? r.json() : null).then(d => {
          if (d) setHumanEvals(d);
        }).catch(console.error);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    fetchReportData();
  }, [id]);

  if (loading) return <div className="p-8 text-white">Generating automated report...</div>;
  if (!run) return <div className="p-8 text-zinc-500">Run not found.</div>;

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

  const downloadFile = (format: string, ext: string) => {
    const link = document.createElement("a");
    link.href = `/api/benchmarks/${id}/export?format=${format}`;
    link.download = `benchmark_run_${id}.${ext}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

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
    <div className="flex-1 w-full h-full overflow-y-auto pr-2 pb-24">
      <div className="max-w-4xl mx-auto bg-white min-h-screen text-black shadow-xl my-8 print:my-0 print:shadow-none p-6 md:p-12 space-y-8 rounded-xl print:rounded-none">
        {/* Print Controls */}
        <div className="flex justify-between items-center pb-6 border-b border-gray-200 print:hidden">
        <button 
          onClick={() => router.back()}
          className="flex items-center gap-2 text-gray-500 hover:text-gray-900 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Dashboard
        </button>
        <div className="flex flex-wrap gap-2">
          <button 
            onClick={() => downloadFile("csv", "csv")}
            className="flex items-center gap-1.5 bg-black text-white px-3 py-1.5 rounded-lg text-xs font-mono font-semibold border border-zinc-800 hover:bg-zinc-800 transition-colors"
          >
            <Download className="h-3.5 w-3.5" /> CSV
          </button>
          <button 
            onClick={() => downloadFile("json", "json")}
            className="flex items-center gap-1.5 bg-black text-white px-3 py-1.5 rounded-lg text-xs font-mono font-semibold border border-zinc-800 hover:bg-zinc-800 transition-colors"
          >
            <FileText className="h-3.5 w-3.5" /> JSON
          </button>
          <button 
            onClick={() => downloadFile("markdown", "md")}
            className="flex items-center gap-1.5 bg-black text-white px-3 py-1.5 rounded-lg text-xs font-mono font-semibold border border-zinc-800 hover:bg-zinc-800 transition-colors"
          >
            <Download className="h-3.5 w-3.5" /> Markdown
          </button>
          <button 
            onClick={() => window.print()}
            className="flex items-center gap-1.5 bg-white text-black px-3 py-1.5 rounded-lg text-xs font-mono font-semibold border border-zinc-300 hover:bg-zinc-100 transition-colors shadow-sm"
          >
            <Printer className="h-3.5 w-3.5" /> Print / PDF
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
          <div><span className="font-semibold text-gray-700">Model Tested:</span> {run.config.model?.name || run.config.model_name || "Standard Model"}</div>
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
             <div className="p-6 bg-zinc-800 border border-purple-200 rounded-xl prose prose-sm max-w-none text-zinc-300" dangerouslySetInnerHTML={{__html: aiRec.replace(/\n/g, "<br/>")}}></div>
          ) : (
             <div className="flex flex-col items-center justify-center p-8 bg-gray-50 border border-gray-200 rounded-xl">
                <p className="text-gray-500 mb-4 text-center">Use your local LLM judge to analyze this benchmark data and synthesize a deployment recommendation.</p>
                <button onClick={generateAiRecommendation} disabled={generatingRec} className="px-4 py-2 bg-zinc-800 hover:bg-zinc-800 text-white font-bold rounded shadow disabled:opacity-50 flex items-center gap-2">
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
               <div className="space-y-2 flex-1 flex flex-col min-h-0 overflow-hidden">
                 {Object.entries(p.categories).map(([cat, data]: [string, any]) => {
                   const avg = data.scores.length > 0 ? data.scores.reduce((a:number,b:number)=>a+b,0)/data.scores.length : 0;
                   return (
                     <div key={cat} className="flex justify-between items-center text-sm">
                       <span className="text-gray-600">{cat}</span>
                       <span className={`font-bold ${avg >= 0.8 ? 'text-green-600' : avg >= 0.5 ? 'text-zinc-400' : 'text-zinc-500'}`}>
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
                    <span className={p.failed > 0 ? "text-zinc-500" : "text-green-600"}>
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
      
      {/* Human Evaluation & Annotation Queue */}
      <section className="space-y-4 pt-6 page-break-before">
        <div className="flex justify-between items-center border-b border-gray-200 pb-2">
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-gray-900">Human Evaluation & Annotation Queue</h2>
          </div>
          {humanEvals && (
            <span className="text-xs font-mono bg-zinc-900 text-white px-2.5 py-1 rounded-full font-semibold border border-zinc-700">
              Human-Judge Alignment: {humanEvals.agreement_rate_pct}% ({humanEvals.total_reviewed} Reviewed)
            </span>
          )}
        </div>

        {/* Human-vs-Automated Alignment Summary Cards */}
        {humanEvals && humanEvals.total_reviewed > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-zinc-50 border border-zinc-200 rounded-xl p-3">
            <div className="space-y-0.5">
              <span className="text-[10px] uppercase font-bold text-zinc-500">Agreement Rate</span>
              <div className="text-xl font-bold text-zinc-900">{humanEvals.agreement_rate_pct}%</div>
              <p className="text-[10px] text-zinc-500">AI & Human score consensus</p>
            </div>
            <div className="space-y-0.5">
              <span className="text-[10px] uppercase font-bold text-zinc-500">Total Annotated</span>
              <div className="text-xl font-bold text-zinc-900">{humanEvals.total_reviewed} <span className="text-xs text-zinc-400 font-normal">/ {allRequests.length}</span></div>
              <p className="text-[10px] text-zinc-500">Reviewed samples</p>
            </div>
            <div className="space-y-0.5">
              <span className="text-[10px] uppercase font-bold text-red-600">False Positives</span>
              <div className="text-xl font-bold text-red-600">
                {allRequests.filter(r => r.auto_passed && (r.human_rating === "INCORRECT" || r.human_rating === "HALLUCINATED")).length}
              </div>
              <p className="text-[10px] text-zinc-500">AI Passed, Human Failed</p>
            </div>
            <div className="space-y-0.5">
              <span className="text-[10px] uppercase font-bold text-amber-600">False Negatives</span>
              <div className="text-xl font-bold text-amber-600">
                {allRequests.filter(r => !r.auto_passed && r.human_rating === "CORRECT").length}
              </div>
              <p className="text-[10px] text-zinc-500">AI Failed, Human Passed</p>
            </div>
          </div>
        )}

        {allRequests.length > 0 && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => setSelectedHumanFilter("ALL")}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold font-mono transition-colors border ${
                  selectedHumanFilter === "ALL" ? "bg-black text-white border-black" : "bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-100"
                }`}
              >
                UNREVIEWED ({allRequests.filter(r => !r.human_rating).length})
              </button>
              <button
                onClick={() => setSelectedHumanFilter("REVIEWED")}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold font-mono transition-colors border ${
                  selectedHumanFilter === "REVIEWED" ? "bg-black text-white border-black" : "bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-100"
                }`}
              >
                REVIEWED ({humanEvals?.total_reviewed || 0})
              </button>
            </div>

            <div className="space-y-2">
              {allRequests
                .filter(r => selectedHumanFilter === "ALL" ? !r.human_rating : !!r.human_rating)
                .slice(0, 50)
                .map((r: any) => {
                  const isEvalActive = activeRequestForEval?.request_id === r.request_id;
                  return (
                    <div key={r.request_id} className="border border-zinc-200 rounded-xl bg-white overflow-hidden shadow-sm">
                      <div 
                        className="p-3 bg-zinc-50/70 hover:bg-zinc-100/80 flex justify-between items-center transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          {r.human_rating ? (
                            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase bg-blue-100 text-blue-800 border border-blue-200">
                              {r.human_rating.replace("_", " ")}
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase bg-zinc-200 text-zinc-600">
                              UNRATED
                            </span>
                          )}
                          <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase ${r.auto_passed ? 'bg-green-100 text-green-800 border-green-200' : 'bg-red-100 text-red-800 border-red-200'}`}>
                            AI: {r.auto_passed ? "PASS" : "FAIL"}
                          </span>
                          <span className="text-xs font-bold text-gray-900 font-mono ml-2">
                            {r.model_name}
                          </span>
                          <span className="text-xs text-gray-500 truncate max-w-[250px]">
                            - {r.prompt_text}
                          </span>
                        </div>
                        <button 
                          onClick={() => {
                            if (isEvalActive) setActiveRequestForEval(null);
                            else { setActiveRequestForEval(r); setEvalFeedback(r.human_feedback || ""); }
                          }}
                          className="text-xs text-blue-600 font-medium px-2 py-1 hover:bg-blue-50 rounded"
                        >
                          {isEvalActive ? "Cancel" : "Grade"}
                        </button>
                      </div>

                      {isEvalActive && (
                        <div className="p-4 border-t border-zinc-200 space-y-3 bg-white text-xs">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                            <div className="space-y-1.5 bg-zinc-50 p-3 rounded-lg border border-zinc-200">
                              <span className="font-bold text-gray-700 text-[10px] uppercase tracking-wider block">Input Prompt</span>
                              <p className="text-gray-900 whitespace-pre-wrap font-sans">{r.prompt_text}</p>
                              {r.expected_answer && (
                                <div className="mt-2 pt-2 border-t border-zinc-200">
                                  <span className="font-bold text-gray-700 text-[10px] uppercase tracking-wider block">Expected Ground Truth</span>
                                  <p className="text-gray-800 font-mono mt-0.5">{r.expected_answer}</p>
                                </div>
                              )}
                            </div>
                            <div className="space-y-1.5 bg-zinc-900 text-zinc-100 p-3 rounded-lg border border-zinc-800">
                              <span className="font-bold text-zinc-400 text-[10px] uppercase tracking-wider block">Actual Model Response</span>
                              <pre className="font-mono text-[11px] whitespace-pre-wrap overflow-x-auto max-h-48 text-zinc-200">
                                {r.actual_response || "(Empty output)"}
                              </pre>
                            </div>
                          </div>

                          <div className="flex flex-col gap-2 bg-blue-50 p-3 rounded-lg border border-blue-100">
                            <label className="text-[10px] font-bold text-blue-900 uppercase tracking-wider">Your Annotation</label>
                            <input 
                              type="text" 
                              placeholder="Optional feedback..."
                              value={evalFeedback}
                              onChange={(e) => setEvalFeedback(e.target.value)}
                              className="w-full text-xs px-2 py-1.5 border border-blue-200 rounded text-blue-900 mb-2"
                            />
                            <div className="flex flex-wrap gap-2">
                              <button onClick={() => submitHumanEval(r.request_id, "CORRECT")} className="px-3 py-1.5 bg-green-600 text-white font-semibold rounded hover:bg-green-700 transition">✓ Correct</button>
                              <button onClick={() => submitHumanEval(r.request_id, "INCORRECT")} className="px-3 py-1.5 bg-red-600 text-white font-semibold rounded hover:bg-red-700 transition">✗ Incorrect</button>
                              <button onClick={() => submitHumanEval(r.request_id, "PARTIALLY_CORRECT")} className="px-3 py-1.5 bg-yellow-500 text-white font-semibold rounded hover:bg-yellow-600 transition">~ Partial</button>
                              <button onClick={() => submitHumanEval(r.request_id, "HALLUCINATED")} className="px-3 py-1.5 bg-purple-600 text-white font-semibold rounded hover:bg-purple-700 transition">✦ Hallucinated</button>
                              <button onClick={() => submitHumanEval(r.request_id, "POOR_FORMAT")} className="px-3 py-1.5 bg-zinc-600 text-white font-semibold rounded hover:bg-zinc-700 transition">▤ Bad Format</button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
                {allRequests.filter(r => selectedHumanFilter === "ALL" ? !r.human_rating : !!r.human_rating).length > 50 && (
                   <div className="text-center text-xs text-zinc-500 py-2">Showing first 50 items.</div>
                )}
            </div>
          </div>
        )}
      </section>

      {/* Failure Analysis & Error Categorization Section */}
      <section className="space-y-4 pt-6">
        <div className="flex justify-between items-center border-b border-gray-200 pb-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-zinc-900" />
            <h2 className="text-xl font-bold text-gray-900">Failure Analysis & Error Categorization</h2>
          </div>
          {failureData && (
            <span className="text-xs font-mono bg-zinc-100 text-zinc-800 px-2.5 py-1 rounded-full font-semibold border border-zinc-200">
              {failureData.failed_requests} Failed / {failureData.total_requests} Total ({failureData.pass_rate_pct}% Pass Rate)
            </span>
          )}
        </div>

        {failureData && failureData.failed_requests === 0 ? (
          <div className="p-6 bg-zinc-50 border border-zinc-200 rounded-xl text-center text-zinc-700 text-sm font-medium">
            Perfect Execution! 100% of benchmark evaluation requests passed all quality, schema, and latency checks.
          </div>
        ) : failureData ? (
          <div className="space-y-3">
            {/* Category Filter Chips */}
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => setSelectedFailureCat("ALL")}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold font-mono transition-colors border ${
                  selectedFailureCat === "ALL" 
                    ? "bg-black text-white border-black" 
                    : "bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-100"
                }`}
              >
                ALL ({failureData.failed_requests})
              </button>
              {Object.entries(failureData.category_counts || {}).filter(([_, count]: [string, any]) => count > 0).map(([cat, count]: [string, any]) => (
                <button
                  key={cat}
                  onClick={() => setSelectedFailureCat(cat)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold font-mono transition-colors border ${
                    selectedFailureCat === cat 
                      ? "bg-black text-white border-black" 
                    : "bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-100"
                }`}
              >
                {cat.replace("_", " ")} ({count})
              </button>
              ))}
            </div>

            {/* Failure Items List */}
            <div className="space-y-2">
              {failureData.failures
                .filter((f: any) => selectedFailureCat === "ALL" || f.failure_category === selectedFailureCat)
                .map((f: any) => {
                  const isExpanded = expandedFailureId === f.request_id;
                  return (
                    <div key={f.request_id} className="border border-zinc-200 rounded-xl bg-white overflow-hidden shadow-sm">
                      <div 
                        onClick={() => setExpandedFailureId(isExpanded ? null : f.request_id)}
                        className="p-3 bg-zinc-50/70 hover:bg-zinc-100/80 cursor-pointer flex justify-between items-center transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase bg-zinc-900 text-white">
                            {f.failure_category}
                          </span>
                          <span className="text-xs font-bold text-gray-900 font-mono">
                            {f.provider_name} ({f.model_name})
                          </span>
                          <span className="text-xs text-gray-500 truncate max-w-[250px]">
                            - {f.prompt_text}
                          </span>
                        </div>
                        <div className="flex items-center gap-3">
                          {f.latency_ms && (
                            <span className="text-[11px] font-mono text-gray-500">
                              {f.latency_ms.toFixed(0)} ms
                            </span>
                          )}
                          <span className="text-xs text-blue-600 font-medium">
                            {isExpanded ? "Collapse" : "Drill Down"}
                          </span>
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="p-4 border-t border-zinc-200 space-y-3 bg-white text-xs">
                          {/* Reason / Diagnosis */}
                          <div className="p-2.5 bg-red-50/50 border border-red-200 rounded-lg">
                            <span className="font-bold text-red-900 uppercase text-[10px] tracking-wider block">Diagnosis / Failure Reason</span>
                            <p className="text-red-800 font-mono mt-0.5">{f.reasoning}</p>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {/* Prompt & Expected */}
                            <div className="space-y-1.5 bg-zinc-50 p-3 rounded-lg border border-zinc-200">
                              <span className="font-bold text-gray-700 text-[10px] uppercase tracking-wider block">Input Prompt</span>
                              <p className="text-gray-900 whitespace-pre-wrap font-sans">{f.prompt_text}</p>
                              {f.expected_answer && (
                                <div className="mt-2 pt-2 border-t border-zinc-200">
                                  <span className="font-bold text-gray-700 text-[10px] uppercase tracking-wider block">Expected Ground Truth</span>
                                  <p className="text-gray-800 font-mono mt-0.5">{f.expected_answer}</p>
                                </div>
                              )}
                            </div>

                            {/* Actual Model Output */}
                            <div className="space-y-1.5 bg-zinc-900 text-zinc-100 p-3 rounded-lg border border-zinc-800">
                              <span className="font-bold text-zinc-400 text-[10px] uppercase tracking-wider block">Actual Model Response</span>
                              <pre className="font-mono text-[11px] whitespace-pre-wrap overflow-x-auto max-h-48 text-zinc-200">
                                {f.actual_response || "(Empty output)"}
                              </pre>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          </div>
        ) : null}
      </section>

      <section className="space-y-4 pt-6">
        <h2 className="text-2xl font-bold border-b border-gray-200 pb-2 flex items-center gap-2">
          <AlertTriangle className="h-6 w-6 text-zinc-400" /> Known Benchmark Limitations
        </h2>
        <ul className="list-disc pl-5 text-sm text-gray-600 space-y-2">
          <li><strong>Network Overhead:</strong> Remote API providers (OpenAI, Together) include network transit latency in TTFT measurements, which disadvantages them compared to local loopback APIs like vLLM.</li>
          <li><strong>Quantization Discrepancies:</strong> If identical model weights were not forced, one runtime may be serving a lower-precision quant (e.g., Q4) while another serves FP16, heavily skewing decode speeds.</li>
          <li><strong>Hardware Saturation:</strong> Runtimes have different maximum batch sizes. Under extreme concurrency, engines like vLLM pull significantly ahead of local developer tools, which may not be visible in single-stream tests.</li>
        </ul>
      </section>
      
    </div>
  </div>
);
}
