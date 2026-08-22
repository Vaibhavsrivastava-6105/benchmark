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
  
  // Tabs
  const [activeTab, setActiveTab] = useState<"models" | "providers">("models");
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
    <div className="p-8 space-y-8 flex-1">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Models Library</h1>
          <p className="text-zinc-400 text-sm mt-1">Cross-reference models and their available inference providers.</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-semibold bg-cyan-500 text-zinc-950 shadow-sm border-0 font-medium  hover:bg-cyan-400 transition-colors transition-colors"
        >
          <Plus className="h-4 w-4 " />
          Register Model
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-zinc-800 pb-px">
        <button
          onClick={() => setActiveTab("models")}
          className={`flex items-center gap-2 px-6 py-3 font-semibold text-sm transition-colors border-b-2 ${
            activeTab === "models" ? "border-pink-500 text-cyan-500" : "border-transparent text-zinc-400 hover:text-zinc-400"
          }`}
        >
          <Database className="h-4 w-4" />
          Models
        </button>
        <button
          onClick={() => setActiveTab("providers")}
          className={`flex items-center gap-2 px-6 py-3 font-semibold text-sm transition-colors border-b-2 ${
            activeTab === "providers" ? "border-emerald-500 text-emerald-600" : "border-transparent text-zinc-400 hover:text-zinc-400"
          }`}
        >
          <Server className="h-4 w-4" />
          Providers
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="bg-[#0c0c0e] border border-zinc-800 rounded-xl p-6 w-full space-y-4">
          <h3 className="font-bold text-white">Register Target Model Parameters</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5 md:col-span-2">
              <label className="text-xs uppercase font-bold tracking-wider text-zinc-400">Model Name / Hugging Face ID</label>
              <input
                type="text"
                placeholder="e.g. meta-llama/Meta-Llama-3-8B-Instruct"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-[#0c0c0e] border border-zinc-800 rounded-lg p-2 text-sm font-mono focus:outline-none focus:border-pink-500"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs uppercase font-bold tracking-wider text-zinc-400">Architecture</label>
              <input type="text" value={architecture} onChange={(e) => setArchitecture(e.target.value)} className="w-full bg-[#0c0c0e] border border-zinc-800 rounded-lg p-2 text-sm focus:outline-none focus:border-pink-500" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs uppercase font-bold tracking-wider text-zinc-400">Parameters Size</label>
              <input type="text" value={parameters} onChange={(e) => setParameters(e.target.value)} className="w-full bg-[#0c0c0e] border border-zinc-800 rounded-lg p-2 text-sm focus:outline-none focus:border-pink-500" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs uppercase font-bold tracking-wider text-zinc-400">Quantization</label>
              <input type="text" value={quantization} onChange={(e) => setQuantization(e.target.value)} className="w-full bg-[#0c0c0e] border border-zinc-800 rounded-lg p-2 text-sm focus:outline-none focus:border-pink-500" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs uppercase font-bold tracking-wider text-zinc-400">Context Window</label>
              <input type="number" value={contextLength} onChange={(e) => setContextLength(parseInt(e.target.value))} className="w-full bg-[#0c0c0e] border border-zinc-800 rounded-lg p-2 text-sm focus:outline-none focus:border-pink-500" />
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-4">
            <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 border border-zinc-800 text-zinc-400 hover:text-white rounded-lg text-sm transition-colors">Cancel</button>
            <button type="submit" className="px-5 py-2 rounded-lg text-sm font-bold bg-cyan-500 text-zinc-950 shadow-sm border-0 font-medium  hover:bg-cyan-400 transition-colors transition-colors">Register</button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="text-zinc-400 font-mono text-xs">Querying database...</div>
      ) : (
        <div className="space-y-6">
          
          {/* TAB: MODELS */}
          {activeTab === "models" && (
            <div className="bg-[#0c0c0e] border border-zinc-800 rounded-xl overflow-hidden">
              <div className="overflow-x-auto max-h-[700px] overflow-y-auto">
                <table className="w-full text-left text-sm border-collapse">
                  <thead className="sticky top-0 bg-[#0c0c0e] z-10 shadow-sm shadow-pink-100">
                    <tr className="text-zinc-400 border-b border-zinc-800 font-semibold text-xs uppercase tracking-wider">
                      <th className="py-4 px-4 whitespace-nowrap">Model Name</th>
                      <th className="py-4 px-4 whitespace-nowrap">Architecture</th>
                      <th className="py-4 px-4 whitespace-nowrap">Parameters</th>
                      <th className="py-4 px-4 whitespace-nowrap">Tokens / Context</th>
                      <th className="py-4 px-4 whitespace-nowrap">Quantization</th>
                      <th className="py-4 px-4">Providers</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800 font-mono text-xs text-zinc-400">
                    {knownModelNames.map(mName => {
                      const dbModel = models.find(m => m.name === mName);
                      const hostedBy = providers.filter(p => p.models?.includes(mName) && p.last_status === "ONLINE");
                      
                      return (
                        <tr key={mName} className="hover:bg-[#0c0c0e]/5 transition-colors">
                          <td className="py-3 px-4 font-sans font-semibold text-white min-w-[200px]">{mName}</td>
                          <td className="py-3 px-4 text-zinc-400">{dbModel?.architecture || <span className="text-zinc-700">-</span>}</td>
                          <td className="py-3 px-4 text-cyan-500 font-semibold">{dbModel?.parameters || <span className="text-zinc-700">-</span>}</td>
                          <td className="py-3 px-4 text-zinc-400">{dbModel?.context_length ? `${dbModel.context_length.toLocaleString()} T` : <span className="text-zinc-700">-</span>}</td>
                          <td className="py-3 px-4">
                            {dbModel?.quantization ? (
                              <span className="px-2 py-0.5 rounded bg-[#0c0c0e] border border-zinc-800 uppercase text-[10px]">
                                {dbModel.quantization}
                              </span>
                            ) : <span className="text-zinc-700">-</span>}
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex flex-wrap gap-1.5 max-w-sm">
                              {hostedBy.length > 0 ? hostedBy.map(p => (
                                <span key={p.id} className="px-2 py-0.5 bg-[#0c0c0e] border border-cyan-900/50 text-cyan-400 rounded text-[10px] whitespace-nowrap">
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
                        <Server className="h-5 w-5 text-emerald-500" />
                        <div>
                          <h3 className="font-bold text-white text-base">{p.name}</h3>
                          <p className="text-xs text-zinc-400 font-mono mt-0.5">{p.base_url}</p>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-4">
                        {p.models && p.models.length > 0 && (
                          <span className="text-xs text-zinc-400 font-medium">
                            {p.models.length} Models
                          </span>
                        )}
                        <span className={`px-2.5 py-1 rounded-md text-[10px] font-bold border ${
                          p.last_status === "ONLINE" ? "bg-emerald-50 text-emerald-600 border-emerald-200" :
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
                          <div className="flex gap-2 items-start bg-red-950/20 border border-zinc-800 p-3 rounded-lg text-red-400 text-xs break-words whitespace-pre-wrap my-4">
                            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                            <div>
                              <strong className="block mb-1">Connection Restricted/Failed:</strong>
                              <span className="text-cyan-500/80 font-mono">{p.last_error}</span>
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
                                <div key={m} className="px-3 py-2 bg-[#0c0c0e] border border-zinc-800 text-xs text-zinc-400 rounded-lg font-mono truncate hover:border-emerald-500/30 transition-colors" title={m}>
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
