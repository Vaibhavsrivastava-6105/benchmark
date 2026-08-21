"use client";

import React, { useState, useEffect } from "react";
import { 
  GitCompare, 
  Award, 
  HelpCircle, 
  Check, 
  Plus, 
  X,
  Gauge,
  Clock,
  Layers,
  ShieldCheck
} from "lucide-react";

const API_BASE = "";

interface Run {
  id: number;
  name: string;
  status: string;
  config: {
    model: { name: string; quantization: string };
    repetitions: number;
    concurrency: number;
  };
  created_at: string;
}

export default function ComparePage() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [selectedRunIds, setSelectedRunIds] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Results of comparison from backend
  const [comparisonResults, setComparisonResults] = useState<any>(null);
  const [loadingComparison, setLoadingComparison] = useState(false);

  // Sliders for dynamic ranking weight recalculation
  const [weights, setWeights] = useState({
    quality: 0.30,
    throughput: 0.20,
    latency: 0.20,
    vram_efficiency: 0.10,
    reliability: 0.10,
    json_reliability: 0.05,
    operational_complexity: 0.05
  });

  const [scoringProfile, setScoringProfile] = useState<string>("balanced");

  // Load runs lists
  useEffect(() => {
    const fetchRuns = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/runs`);
        const data = await res.json();
        // Only allow comparing completed benchmarks
        setRuns(data.filter((r: Run) => r.status === "COMPLETED"));
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchRuns();
  }, []);

  // Update backend comparison whenever selected runs change
  useEffect(() => {
    if (selectedRunIds.length === 0) {
      setComparisonResults(null);
      return;
    }
    
    const triggerCompare = async () => {
      setLoadingComparison(true);
      try {
        const res = await fetch(`${API_BASE}/api/comparisons`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ run_ids: selectedRunIds })
        });
        const data = await res.json();
        setComparisonResults(data);
      } catch (err) {
        console.error(err);
      } finally {
        setLoadingComparison(false);
      }
    };
    
    triggerCompare();
  }, [selectedRunIds]);

  const toggleSelectRun = (id: number) => {
    setSelectedRunIds(prev => {
      if (prev.includes(id)) {
        return prev.filter(x => x !== id);
      } else {
        if (prev.length >= 10) {
          alert("Maximum of 10 runs can be selected for comparison.");
          return prev;
        }
        return [...prev, id];
      }
    });
  };

  const handleProfileSelect = (profile: string) => {
    setScoringProfile(profile);
    if (profile === "balanced") {
      setWeights({ quality: 0.30, throughput: 0.20, latency: 0.20, vram_efficiency: 0.10, reliability: 0.10, json_reliability: 0.05, operational_complexity: 0.05 });
    } else if (profile === "local") {
      setWeights({ quality: 0.15, throughput: 0.10, latency: 0.15, vram_efficiency: 0.15, reliability: 0.10, json_reliability: 0.05, operational_complexity: 0.30 });
    } else if (profile === "production") {
      setWeights({ quality: 0.25, throughput: 0.25, latency: 0.25, vram_efficiency: 0.05, reliability: 0.15, json_reliability: 0.05, operational_complexity: 0.00 });
    } else if (profile === "latency") {
      setWeights({ quality: 0.20, throughput: 0.10, latency: 0.50, vram_efficiency: 0.05, reliability: 0.10, json_reliability: 0.02, operational_complexity: 0.03 });
    } else if (profile === "vram") {
      setWeights({ quality: 0.20, throughput: 0.10, latency: 0.10, vram_efficiency: 0.40, reliability: 0.10, json_reliability: 0.05, operational_complexity: 0.05 });
    }
  };

  const handleWeightChange = (key: string, val: number) => {
    setWeights(prev => {
      const next = { ...prev, [key]: val };
      // Normalize other keys slightly or just keep absolute sum visible
      return next;
    });
    setScoringProfile("custom");
  };

  // Dynamic ranking recalculation in client based on weights
  const getRankedRuntimes = () => {
    if (!comparisonResults || !comparisonResults.metrics) return [];
    
    const metrics = comparisonResults.metrics;
    
    // Bounds for normalization
    const tputs = metrics.map((m: any) => m.throughput_tok_s);
    const ttfts = metrics.map((m: any) => m.ttft_ms).filter((t: any) => t !== null && t !== undefined);
    const vramEffs = metrics.map((m: any) => m.vram_efficiency_tok_s_gb);

    const maxT = Math.max(...tputs) || 100.0;
    const minT = Math.min(...tputs) || 0.0;
    
    const maxTtft = Math.max(...ttfts) || 1000.0;
    const minTtft = Math.min(...ttfts) || 50.0;

    const maxVe = Math.max(...vramEffs) || 20.0;
    const minVe = Math.min(...vramEffs) || 0.0;

    const ranked = metrics.map((m: any) => {
      // Norm calculations
      const t_span = maxT - minT;
      const u_tput = t_span > 0 ? ((m.throughput_tok_s - minT) / t_span * 100.0) : 100.0;

      let u_latency = 0.0;
      if (m.ttft_ms !== null && m.ttft_ms !== undefined) {
        const ttft_span = maxTtft - minTtft;
        u_latency = ttft_span > 0 ? ((maxTtft - m.ttft_ms) / ttft_span * 100.0) : 100.0;
      }

      const ve_span = maxVe - minVe;
      const u_vram = ve_span > 0 ? ((m.vram_efficiency_tok_s_gb - minVe) / ve_span * 100.0) : 100.0;

      const sumWeights = Object.values(weights).reduce((a, b) => a + b, 0);
      const divider = sumWeights > 0 ? sumWeights : 1.0;

      const composite = (
        m.quality_pct * weights.quality +
        u_tput * weights.throughput +
        u_latency * weights.latency +
        u_vram * weights.vram_efficiency +
        m.reliability_pct * weights.reliability +
        m.json_reliability_pct * weights.json_reliability +
        m.operational_complexity_score * weights.operational_complexity
      ) / divider;

      return {
        ...m,
        score: Math.round(composite)
      };
    });

    return ranked.sort((a: any, b: any) => b.score - a.score);
  };

  const rankedRuntimes = getRankedRuntimes();

  return (
    <div className="p-8 space-y-8 flex-1">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Compare Runtimes</h1>
        <p className="text-zinc-400 text-sm mt-1">Multi-criteria comparative matrix and decision recommendation tool.</p>
      </div>

      {/* Select Experiments Bar */}
      <div className="bg-[#0c0c0e] border border-zinc-800 rounded-xl p-5 space-y-4">
        <h3 className="text-sm font-semibold text-zinc-350">Select runs to compare (2 to 10):</h3>
        
        {loading ? (
          <div className="text-xs text-zinc-400 font-mono">Loading previous completed runs...</div>
        ) : runs.length === 0 ? (
          <div className="text-xs text-zinc-400 font-mono">No completed runs found. Execute some benchmarks first.</div>
        ) : (
          <div className="flex flex-wrap gap-3">
            {runs.map(r => {
              const selected = selectedRunIds.includes(r.id);
              return (
                <button
                  key={r.id}
                  onClick={() => toggleSelectRun(r.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border flex items-center gap-2 transition-all ${
                    selected ? "bg-[#0c0c0e] text-cyan-500 border-zinc-800" : "bg-[#0c0c0e] border-zinc-800 text-zinc-400 hover:border-zinc-800"
                  }`}
                >
                  {selected ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                  <span>{r.name} ({r.config?.model?.name})</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Comparison Workspace */}
      {selectedRunIds.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Main Scoring Matrix (Left 2 cols) */}
          <div className="lg:col-span-2 space-y-6">
            
            {/* Recommendations Verdict */}
            {comparisonResults && (
              <div className="bg-emerald-50/20 border border-emerald-200 rounded-xl p-6 space-y-3">
                <div className="flex items-center gap-2 text-emerald-600 font-bold text-xs uppercase tracking-widest">
                  <Award className="h-4.5 w-4.5" />
                  Winner Verdict (Balanced Profile)
                </div>
                <p className="text-sm leading-relaxed text-zinc-400">
                  {comparisonResults.why_win_summary || "Computing metrics summary..."}
                </p>
              </div>
            )}

            {/* Matrix Table */}
            <div className="bg-[#0c0c0e] border border-zinc-800 rounded-xl p-6 space-y-4">
              <h3 className="font-bold text-white flex items-center gap-2">
                <GitCompare className="h-5 w-5 text-purple-500" />
                Comparison Matrix
              </h3>
              
              {loadingComparison ? (
                <div className="text-center text-xs py-24 text-zinc-400 animate-pulse font-mono">Running metrics pipeline...</div>
              ) : rankedRuntimes.length === 0 ? (
                <div className="text-center text-xs py-24 text-zinc-400 font-mono">Select at least one run to compute performance indices.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="text-zinc-400 border-b border-zinc-800 uppercase tracking-wider font-semibold text-[10px]">
                        <th className="py-2.5 px-3">Runtime</th>
                        <th className="py-2.5 px-3 text-right">Composite Score</th>
                        <th className="py-2.5 px-3 text-right">Throughput</th>
                        <th className="py-2.5 px-3 text-right">TTFT (ms)</th>
                        <th className="py-2.5 px-3 text-right">Quality</th>
                        <th className="py-2.5 px-3 text-right">VRAM</th>
                        <th className="py-2.5 px-3 text-right">Reliability</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800 font-mono text-zinc-400">
                      {rankedRuntimes.map((m: any, idx: number) => (
                        <tr key={idx} className="hover:bg-[#0c0c0e]/5 transition-colors">
                          <td className="py-3 px-3 font-sans font-semibold text-white">
                            {m.provider_name}
                            <span className="text-[9px] text-zinc-400 font-mono uppercase block mt-0.5">
                              {m.provider_type}
                            </span>
                          </td>
                          <td className="py-3 px-3 text-right text-cyan-500 font-bold text-sm">
                            {m.score} / 100
                          </td>
                          <td className="py-3 px-3 text-right text-emerald-600 font-bold">
                            {m.throughput_tok_s.toFixed(1)} t/s
                          </td>
                          <td className="py-3 px-3 text-right text-amber-500">
                            {m.ttft_ms ? `${m.ttft_ms.toFixed(0)} ms` : "N/A"}
                          </td>
                          <td className="py-3 px-3 text-right text-zinc-400">
                            {m.quality_pct.toFixed(1)}%
                          </td>
                          <td className="py-3 px-3 text-right text-purple-400">
                            {m.vram_used_gb.toFixed(1)} GB
                          </td>
                          <td className="py-3 px-3 text-right text-zinc-400">
                            {m.reliability_pct.toFixed(0)}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            
            {/* Fair Comparison Warnings */}
            <div className="bg-[#0c0c0e] border border-zinc-800 rounded-xl p-4 flex gap-3 items-start">
              <HelpCircle className="h-5 w-5 text-zinc-400 shrink-0 mt-0.5" />
              <div className="text-xs space-y-1">
                <span className="font-semibold text-zinc-400">Fair Benchmarking Notice:</span>
                <p className="text-zinc-400 leading-relaxed">
                  The platform compares models on identical contexts and seed settings. If you compare configs with differing quantization algorithms or hardware architectures, 
                  the platform will calculate raw numbers, but comparisons should be considered approximate.
                </p>
              </div>
            </div>

          </div>

          {/* Dynamic Weight Configuration (Right column) */}
          <div className="bg-[#0c0c0e] border border-zinc-800 rounded-xl p-6 space-y-6">
            <div className="space-y-1">
              <h3 className="font-bold text-white">Objective Weights</h3>
              <p className="text-xs text-zinc-400">Tune objectives to dynamically recalculate run scores.</p>
            </div>

            {/* Profile buttons */}
            <div className="flex flex-wrap gap-2">
              {[
                { key: "balanced", label: "Balanced" },
                { key: "local", label: "Local DX" },
                { key: "production", label: "Production" },
                { key: "latency", label: "Low Latency" },
                { key: "vram", label: "Low VRAM" }
              ].map(p => (
                <button
                  key={p.key}
                  onClick={() => handleProfileSelect(p.key)}
                  className={`px-2.5 py-1 rounded text-[10px] font-bold border transition-colors ${
                    scoringProfile === p.key ? "bg-cyan-500 text-zinc-950 shadow-sm border-0 font-medium  border-pink-500" : "bg-[#0c0c0e] border-zinc-800 text-zinc-400 hover:text-white"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <div className="h-[1px] bg-[#0c0c0e]" />

            {/* Sliders */}
            <div className="space-y-4">
              {[
                { key: "quality", label: "Response Quality", color: "accent-cyan-500" },
                { key: "throughput", label: "Throughput (tok/s)", color: "accent-emerald-500" },
                { key: "latency", label: "Latency (TTFT)", color: "accent-amber-500" },
                { key: "vram_efficiency", label: "VRAM Memory Efficiency", color: "accent-purple-500" },
                { key: "reliability", label: "Serving Success Rate", color: "accent-zinc-400" },
                { key: "json_reliability", label: "Structured JSON Compliance", color: "accent-cyan-400" },
                { key: "operational_complexity", label: "Developer Setup Simplicity", color: "accent-indigo-400" }
              ].map(slider => {
                const val = (weights as any)[slider.key];
                return (
                  <div key={slider.key} className="space-y-1.5">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-zinc-400">{slider.label}</span>
                      <span className="font-mono text-zinc-400 font-semibold">{Math.round(val * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={val}
                      onChange={(e) => handleWeightChange(slider.key, parseFloat(e.target.value))}
                      className={`w-full ${slider.color}`}
                    />
                  </div>
                );
              })}
            </div>

            <div className="text-[10px] text-zinc-400 bg-black/30 border border-zinc-800 p-3 rounded-lg leading-relaxed font-mono">
              Composite score utility formula: sum(NormalizedMetrics[i] * Weight[i]) / sum(Weights). 
              Percentages recalculate in-browser instantly.
            </div>

          </div>

        </div>
      )}
    </div>
  );
}
