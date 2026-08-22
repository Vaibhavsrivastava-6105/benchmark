"use client";
import React, { useState, useEffect } from "react";
import { Plus, Server, Database, AlertCircle, ChevronDown, ChevronRight, Box } from "lucide-react";

const API_BASE = "";

interface Model {
  id: number;
  name: string;
  architecture?: string;
  parameters?: string;
  quantization?: string;
  context_length?: number;
}

interface Provider {
  id: number;
  name: string;
  type: string;
  base_url: string;
  last_status?: string;
  last_error?: string;
  last_models?: string;
  models?: string[];
}

export default function ModelsPage() {
  const [models, setModels] = useState<Model[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [scannedModels, setScannedModels] = useState<any[]>([]);
  const [scanning, setScanning] = useState(false);
  
  // Tabs
  const [activeTab, setActiveTab] = useState<"models" | "providers" | "scanned">("models");
  // Accordion state for providers
  const [expandedProvider, setExpandedProvider] = useState<number | null>(null);

  // Form
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [revision, setRevision] = useState("latest");
  const [quantization, setQuantization] = useState("FP16");
  const [sizeBytes, setSizeBytes] = useState<number>(0);
  const [contextLength, setContextLength] = useState<number>(8192);
  const [parameters, setParameters] = useState("8B");
  const [architecture, setArchitecture] = useState("Llama");

  const fetchData = async () => {
    try {
      const [modRes, provRes] = await Promise.all([
        fetch(`${API_BASE}/api/models`),
        fetch(`${API_BASE}/api/providers`)
      ]);
      const modData = await modRes.json();
      const provData = await provRes.json();

      const parsedProvs = provData.map((p: any) => {
        if (!p.models && p.last_models) {
          try { p.models = JSON.parse(p.last_models); } catch (e) { p.models = []; }
        }
        return p;
      });

      setModels(modData);
      setProviders(parsedProvs);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const scanLocalModels = async () => {
    setScanning(true);
    try {
      const res = await fetch(`${API_BASE}/api/models/scan`);
      if (res.ok) {
        const data = await res.json();
        setScannedModels(data.models || []);
        setActiveTab("scanned");
      }
    } catch (e) {
      console.error(e);
    } finally {
      setScanning(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name) return;

    const payload = {
      name,
      revision,
      quantization,
      size_bytes: sizeBytes || null,
      context_length: contextLength || null,
      parameters,
      architecture
    };

    try {
      const res = await fetch(`${API_BASE}/api/models`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        setShowForm(false);
        setName("");
        fetchData();
      } else {
        alert("Failed to register model.");
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Derived unified data
  // Only show models that are actively reported as downloaded by local engines
  const knownModelNames = Array.from(new Set([
    ...providers.flatMap(p => p.models || [])
  ])).sort();

  return (
    <div className="p-2 space-y-2 flex-1 h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-sm font-bold tracking-tight">Models Library</h1>
          <p className="text-zinc-400 text-sm mt-1">Cross-reference models and their available inference providers.</p>
        </div>
                <div className="flex gap-2">
          <button
            onClick={scanLocalModels}
            disabled={scanning}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-zinc-900 border border-zinc-800 text-white hover:bg-zinc-800 transition-colors"
          >
            <Box className={`h-3.5 w-3.5 ${scanning ? "animate-spin" : ""}`} />
            {scanning ? "Scanning Storage..." : "Scan Local Files (.gguf)"}
          </button>
          <button
            onClick={() => setShowForm(!showForm)}
            className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm font-semibold bg-white text-black text-zinc-950 shadow-sm border-0 font-medium  hover:bg-zinc-800 transition-colors transition-colors"
          >
            <Plus className="h-4 w-4 " />
            Register Model
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-zinc-800 pb-px">
        <button
          onClick={() => setActiveTab("models")}
          className={`flex items-center gap-2 px-2 py-1 font-semibold text-sm transition-colors border-b-2 ${
            activeTab === "models" ? "border-zinc-500 text-white" : "border-transparent text-zinc-400 hover:text-zinc-400"
          }`}
        >
          <Database className="h-4 w-4" />
          Models
        </button>
        <button
          onClick={() => { setActiveTab("scanned"); if (scannedModels.length === 0) scanLocalModels(); }}
          className={`flex items-center gap-2 px-2 py-1 font-semibold text-sm transition-colors border-b-2 ${
            activeTab === "scanned" ? "border-zinc-500 text-white" : "border-transparent text-zinc-400 hover:text-zinc-400"
          }`}
        >
          <Box className="h-4 w-4" />
          Discovered Files ({scannedModels.length})
        </button>
        <button
          onClick={() => setActiveTab("providers")}
          className={`flex items-center gap-2 px-2 py-1 font-semibold text-sm transition-colors border-b-2 ${
            activeTab === "providers" ? "border-zinc-500 text-zinc-100" : "border-transparent text-zinc-400 hover:text-zinc-400"
          }`}
        >
          <Server className="h-4 w-4" />
          Providers
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="bg-[#0c0c0e] border border-zinc-800 rounded-xl p-2 w-full space-y-1">
          <h3 className="font-bold text-white">Register Target Model Parameters</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-1">
            <div className="space-y-1.5 md:col-span-2">
              <label className="text-xs uppercase font-bold tracking-wider text-zinc-400">Model Name / Hugging Face ID</label>
              <input
                type="text"
                placeholder="e.g. meta-llama/Meta-Llama-3-8B-Instruct"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-[#0c0c0e] border border-zinc-800 rounded-lg p-2 text-sm font-mono focus:outline-none focus:border-zinc-500"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs uppercase font-bold tracking-wider text-zinc-400">Architecture</label>
              <input type="text" value={architecture} onChange={(e) => setArchitecture(e.target.value)} className="w-full bg-[#0c0c0e] border border-zinc-800 rounded-lg p-2 text-sm focus:outline-none focus:border-zinc-500" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs uppercase font-bold tracking-wider text-zinc-400">Parameters Size</label>
              <input type="text" value={parameters} onChange={(e) => setParameters(e.target.value)} className="w-full bg-[#0c0c0e] border border-zinc-800 rounded-lg p-2 text-sm focus:outline-none focus:border-zinc-500" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs uppercase font-bold tracking-wider text-zinc-400">Quantization</label>
              <input type="text" value={quantization} onChange={(e) => setQuantization(e.target.value)} className="w-full bg-[#0c0c0e] border border-zinc-800 rounded-lg p-2 text-sm focus:outline-none focus:border-zinc-500" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs uppercase font-bold tracking-wider text-zinc-400">Context Window</label>
              <input type="number" value={contextLength} onChange={(e) => setContextLength(parseInt(e.target.value))} className="w-full bg-[#0c0c0e] border border-zinc-800 rounded-lg p-2 text-sm focus:outline-none focus:border-zinc-500" />
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-4">
            <button type="button" onClick={() => setShowForm(false)} className="px-2 py-2 border border-zinc-800 text-zinc-400 hover:text-white rounded-lg text-sm transition-colors">Cancel</button>
            <button type="submit" className="px-5 py-2 rounded-lg text-sm font-bold bg-white text-black text-zinc-950 shadow-sm border-0 font-medium  hover:bg-zinc-800 transition-colors transition-colors">Register</button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="text-zinc-400 font-mono text-xs">Querying database...</div>
      ) : (
        <div className="space-y-2 flex-1 flex flex-col min-h-0 overflow-hidden">
          
          {/* TAB: MODELS */}
          {activeTab === "models" && (
            <div className="bg-[#0c0c0e] border border-zinc-800 rounded-xl overflow-hidden flex-1 flex flex-col">
              <div className="overflow-auto flex-1">
                <table className="w-full text-left text-sm border-collapse">
                  <thead className="sticky top-0 bg-[#0c0c0e] z-10 shadow-sm shadow-pink-100">
                    <tr className="text-zinc-400 border-b border-zinc-800 font-semibold text-xs uppercase tracking-wider">
                      <th className="py-1 px-2 whitespace-nowrap">Model Name</th>
                      <th className="py-1 px-2 whitespace-nowrap">Architecture</th>
                      <th className="py-1 px-2 whitespace-nowrap">Parameters</th>
                      <th className="py-1 px-2 whitespace-nowrap">Tokens / Context</th>
                      <th className="py-1 px-2 whitespace-nowrap">Quantization</th>
                      <th className="py-1 px-2">Providers</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800 font-mono text-xs text-zinc-400">
                    {knownModelNames.map(mName => {
                      const dbModel = models.find(m => m.name === mName);
                      const hostedBy = providers.filter(p => p.models?.includes(mName) && p.last_status === "ONLINE");
                      
                      return (
                        <tr key={mName} className="hover:bg-[#0c0c0e]/5 transition-colors">
                          <td className="py-1 px-2 font-sans font-semibold text-white min-w-[200px]">{mName}</td>
                          <td className="py-1 px-2 text-zinc-400">{dbModel?.architecture || <span className="text-zinc-700">-</span>}</td>
                          <td className="py-1 px-2 text-white font-semibold">{dbModel?.parameters || <span className="text-zinc-700">-</span>}</td>
                          <td className="py-1 px-2 text-zinc-400">{dbModel?.context_length ? `${dbModel.context_length.toLocaleString()} T` : <span className="text-zinc-700">-</span>}</td>
                          <td className="py-1 px-2">
                            {dbModel?.quantization ? (
                              <span className="px-2 py-0.5 rounded bg-[#0c0c0e] border border-zinc-800 uppercase text-[10px]">
                                {dbModel.quantization}
                              </span>
                            ) : <span className="text-zinc-700">-</span>}
                          </td>
                          <td className="py-1 px-2">
                            <div className="flex flex-wrap gap-1.5 max-w-sm">
                              {hostedBy.length > 0 ? hostedBy.map(p => (
                                <span key={p.id} className="px-2 py-0.5 bg-[#0c0c0e] border border-white text-white rounded text-[10px] whitespace-nowrap">
                                  {p.name}
                                </span>
                              )) : (
                                <span className="text-zinc-400 italic">No online providers</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB: PROVIDERS */}
                {/* Scanned Local Models Tab */}
      {activeTab === "scanned" && (
        <div className="flex-1 overflow-y-auto min-h-0 space-y-2 pr-1">
          {scannedModels.length === 0 ? (
            <div className="p-8 border border-dashed border-zinc-800 rounded-xl text-center text-zinc-500 font-mono text-xs">
              No local .gguf or .safetensors files discovered yet. Click "Scan Local Files" above to index your system.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
              {scannedModels.map((m: any, idx: number) => (
                <div key={idx} className="bg-[#0c0c0e] border border-zinc-800 rounded-xl p-3 flex flex-col justify-between space-y-2">
                  <div className="space-y-1">
                    <div className="flex justify-between items-start gap-2">
                      <h4 className="font-bold text-white text-xs truncate" title={m.filename}>{m.filename}</h4>
                      <span className="text-[10px] bg-black border border-zinc-800 text-zinc-300 font-mono px-1.5 py-0.5 rounded">
                        {m.format}
                      </span>
                    </div>
                    <div className="text-[10px] text-zinc-500 font-mono truncate" title={m.path}>
                      {m.path}
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-1 bg-black/40 border border-zinc-800/60 rounded-lg p-2 text-center font-mono text-[10px]">
                    <div>
                      <div className="text-zinc-500 text-[9px]">FILE SIZE</div>
                      <div className="text-white font-semibold">{m.size_gb} GB</div>
                    </div>
                    <div>
                      <div className="text-zinc-500 text-[9px]">QUANT</div>
                      <div className="text-white font-semibold">{m.quantization}</div>
                    </div>
                    <div>
                      <div className="text-zinc-500 text-[9px]">EST. VRAM</div>
                      <div className="text-white font-semibold">{m.estimated_vram_gb} GB</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === "providers" && (
            <div className="space-y-3">
              {providers.map(p => {
                const isExpanded = expandedProvider === p.id;
                
                return (
                  <div key={p.id} className="bg-[#0c0c0e] border border-zinc-800 rounded-xl overflow-hidden transition-all">
                    {/* Header Button */}
                    <button 
                      onClick={() => setExpandedProvider(isExpanded ? null : p.id)}
                      className="w-full flex items-center justify-between p-4 hover:bg-transparent transition-colors text-left"
                    >
                      <div className="flex items-center gap-3">
                        {isExpanded ? <ChevronDown className="h-5 w-5 text-zinc-400" /> : <ChevronRight className="h-5 w-5 text-zinc-400" />}
                        <Server className="h-5 w-5 text-zinc-100" />
                        <div>
                          <h3 className="font-bold text-white text-base">{p.name}</h3>
                          <p className="text-xs text-zinc-400 font-mono mt-0.5">{p.base_url}</p>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-1">
                        {p.models && p.models.length > 0 && (
                          <span className="text-xs text-zinc-400 font-medium">
                            {p.models.length} Models
                          </span>
                        )}
                        <span className={`px-2.5 py-1 rounded-md text-[10px] font-bold border ${
                          p.last_status === "ONLINE" ? "bg-zinc-900 text-zinc-100 border-zinc-500" :
                          p.last_status === "OFFLINE" ? "bg-zinc-800 text-white border-zinc-800" :
                          "bg-black text-zinc-400 border-zinc-800"
                        }`}>
                          {p.last_status || "UNTESTED"}
                        </span>
                      </div>
                    </button>
                    
                    {/* Expanded Content */}
                    {isExpanded && (
                      <div className="p-4 pt-0 border-t border-zinc-800 bg-[#0c0c0e]/5">
                        {p.last_status === "OFFLINE" && p.last_error && (
                          <div className="flex gap-2 items-start bg-zinc-800 border border-zinc-800 p-3 rounded-lg text-zinc-500 text-xs break-words whitespace-pre-wrap my-4">
                            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                            <div>
                              <strong className="block mb-1">Connection Restricted/Failed:</strong>
                              <span className="text-white/80 font-mono">{p.last_error}</span>
                            </div>
                          </div>
                        )}

                        <div className="mt-4">
                          <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-3 flex items-center gap-2">
                            <Box className="h-4 w-4" /> 
                            Models Hosted by {p.name}
                          </h4>
                          
                          {p.models && p.models.length > 0 ? (
                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                              {p.models.map(m => (
                                <div key={m} className="px-3 py-2 bg-[#0c0c0e] border border-zinc-800 text-xs text-zinc-400 rounded-lg font-mono truncate hover:border-zinc-500 transition-colors" title={m}>
                                  {m}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="text-sm text-zinc-400 italic p-4 bg-[#0c0c0e] border border-zinc-800 rounded-lg text-center">
                              {p.last_status === "UNTESTED" 
                                ? "Test the connection on the Providers tab to load models." 
                                : "No models found for this provider."}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          
        </div>
      )}
    </div>
  );
}
