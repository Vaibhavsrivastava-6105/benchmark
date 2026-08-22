"use client";

import React, { useState, useEffect } from "react";
import { 
  Server, 
  Plus, 
  CheckCircle, 
  XCircle, 
  Activity, 
  RefreshCw,
  Eye,
  EyeOff
} from "lucide-react";

const API_BASE = "";

interface Provider {
  id: number;
  name: string;
  type: string;
  base_url: string;
  api_key?: string;
  enabled: boolean;
  status?: string;
  models?: string[];
  error?: string;
  last_status?: string;
  last_error?: string;
  max_concurrency?: number | null;
}

export default function ProvidersPage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingKeys, setPendingKeys] = useState<Record<number, string>>({});
  const [pendingConcurrency, setPendingConcurrency] = useState<Record<number, string>>({});
  const [testingId, setTestingId] = useState<number | null>(null);

  // New Provider Form
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState("openai_compatible");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [maxConcurrency, setMaxConcurrency] = useState<number | "">("");

  const fetchProviders = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/providers`);
      const data = await res.json();
      
      const parsedData = data.map((p: any) => {
        if (!p.models && p.last_models) {
          try {
            p.models = JSON.parse(p.last_models);
          } catch (e) {
            p.models = [];
          }
        }
        return p;
      });
      
      setProviders(parsedData);
    } catch (err) {
      console.error(err); setProviders([{id:999, name: "ERROR: " + err.message, type: "error", base_url: "", enabled: false}]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProviders();
  }, []);

  const testConnection = async (id: number) => {
    setTestingId(id);
    try {
      const res = await fetch(`${API_BASE}/api/providers/${id}/health`, { method: "POST" });
      const data = await res.json();
      setProviders(prev => prev.map(p => {
        if (p.id === id) {
          return { ...p, status: data.status, models: data.models, error: data.error };
        }
        return p;
      }));
    } catch (err) {
      setProviders(prev => prev.map(p => {
        if (p.id === id) {
          return { ...p, status: "OFFLINE", error: "Failed to connect to backend" };
        }
        return p;
      }));
    } finally {
      setTestingId(null);
    }
  };

  const saveProviderKey = async (id: number) => {
    const p = providers.find(x => x.id === id);
    const newKey = pendingKeys[id];
    if (!p || newKey === undefined) return;
    try {
      await fetch(`${API_BASE}/api/providers/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: p.name,
          type: p.type,
          base_url: p.base_url,
          api_key: newKey,
          enabled: p.enabled
        })
      });
      alert("API Key saved successfully!");
      setPendingKeys(prev => { const next = {...prev}; delete next[id]; return next; });
      fetchProviders();
    } catch (err) {
      alert("Failed to save API key");
    }
  };

  const saveProviderConcurrency = async (id: number) => {
    const p = providers.find(x => x.id === id);
    const newConcStr = pendingConcurrency[id];
    if (!p || newConcStr === undefined) return;
    
    let max_conc = null;
    if (newConcStr.trim() !== "") {
      max_conc = parseInt(newConcStr);
      if (isNaN(max_conc) || max_conc <= 0) {
        alert("Concurrency must be a positive integer or left blank.");
        return;
      }
    }

    try {
      await fetch(`${API_BASE}/api/providers/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          max_concurrency: max_conc
        })
      });
      alert("Max Concurrency saved successfully!");
      setPendingConcurrency(prev => { const next = {...prev}; delete next[id]; return next; });
      fetchProviders();
    } catch (err) {
      alert("Failed to save max concurrency");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !baseUrl) {
      alert("Name and Base URL are required.");
      return;
    }

    const payload = {
      name,
      type,
      base_url: baseUrl,
      api_key: apiKey || null,
      enabled,
      max_concurrency: maxConcurrency !== "" ? parseInt(String(maxConcurrency)) : null
    };

    try {
      const res = await fetch(`${API_BASE}/api/providers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        setShowForm(false);
        setName("");
        setBaseUrl("http://localhost:11434");
        setApiKey("");
        fetchProviders();
      } else {
        alert("Failed to create provider.");
      }
    } catch (err) {
      console.error(err); setProviders([{id:999, name: "ERROR: " + err.message, type: "error", base_url: "", enabled: false}]);
      alert("Network error.");
    }
  };

    const [filter, setFilter] = useState<"all" | "local" | "cloud">("all");

  const filteredProviders = providers.filter(p => {
    if (filter === "all") return true;
    const isLocal = p.name.toLowerCase().includes("local") || p.base_url.includes("127.0.0.1") || p.base_url === "local" || p.base_url.includes("localhost");
    if (filter === "local") return isLocal;
    if (filter === "cloud") return !isLocal;
    return true;
  });

  return (
    <div className="p-2 space-y-2 flex-1 h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-sm font-bold tracking-tight">Providers Configuration</h1>
          <p className="text-zinc-400 text-sm mt-1">Register and test connection settings for active serving runtimes.</p>
        </div>

        {/* Filters */}
        <div className="flex gap-2 bg-[#0c0c0e] p-1 rounded-lg w-fit border border-zinc-800">
          <button onClick={() => setFilter("all")} className={`px-2 py-1.5 rounded-md text-sm font-medium transition-colors ${filter === 'all' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-white'}`}>All</button>
          <button onClick={() => setFilter("local")} className={`px-2 py-1.5 rounded-md text-sm font-medium transition-colors ${filter === 'local' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-white'}`}>Local Runtimes</button>
          <button onClick={() => setFilter("cloud")} className={`px-2 py-1.5 rounded-md text-sm font-medium transition-colors ${filter === 'cloud' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-white'}`}>Cloud APIs</button>
        </div>

        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm font-semibold bg-white text-black text-zinc-950 shadow-sm border-0 font-medium  hover:bg-zinc-800 transition-colors transition-colors"
        >
          <Plus className="h-4 w-4 " />
          Add Provider
        </button>
      </div>

      {/* Add Form Panel */}
      {showForm && (
        <form onSubmit={handleSubmit} className="bg-[#0c0c0e] border border-zinc-800 rounded-xl p-2 w-full space-y-1">
          <h3 className="font-bold text-white">New Provider Details</h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-1">
            <div className="space-y-1.5">
              <label className="text-xs uppercase font-bold tracking-wider text-zinc-400">Provider Name</label>
              <input
                type="text"
                placeholder="e.g. Local Ollama 7B"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-[#0c0c0e] border border-zinc-800 rounded-lg p-2 text-sm focus:outline-none focus:border-zinc-500"
              />
            </div>
            
            <div className="space-y-1.5">
              <label className="text-xs uppercase font-bold tracking-wider text-zinc-400">Provider Type</label>
              <select
                value={type}
                onChange={(e) => {
                  setType(e.target.value);
                  if (e.target.value === "ollama") setBaseUrl("http://localhost:11434");
                  else if (e.target.value === "vllm") setBaseUrl("http://127.0.0.1:8000/v1");
                  else if (e.target.value === "llamacpp") setBaseUrl("http://localhost:8080/v1");
                  else if (e.target.value === "transformers") setBaseUrl("local");
                  else if (e.target.value === "mock") setBaseUrl("http://localhost:0");
                }}
                className="w-full bg-[#0c0c0e] border border-zinc-800 rounded-lg p-2 text-sm focus:outline-none focus:border-zinc-500"
              >
                <option value="ollama">Ollama</option>
                <option value="vllm">vLLM Server</option>
                <option value="llamacpp">llama.cpp / llama-server</option>
                <option value="transformers">Transformers (direct)</option>
                <option value="openai_compatible">OpenAI Compatible API</option>
                <option value="mock">Mock Serving (Testing)</option>
              </select>
            </div>

            <div className="space-y-1.5 md:col-span-2">
              <label className="text-xs uppercase font-bold tracking-wider text-zinc-400">Base URL endpoint</label>
              <input
                type="text"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                className="w-full bg-[#0c0c0e] border border-zinc-800 rounded-lg p-2 text-sm font-mono focus:outline-none focus:border-zinc-500"
              />
            </div>

            <div className="space-y-1.5 md:col-span-2">
              <label className="text-xs uppercase font-bold tracking-wider text-zinc-400">API Key (Optional)</label>
              <input
                type="password"
                placeholder="sk-..."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="w-full bg-[#0c0c0e] border border-zinc-800 rounded-lg p-2 text-sm font-mono focus:outline-none focus:border-zinc-500"
              />
            </div>

            <div className="space-y-1.5 md:col-span-2">
              <label className="text-xs uppercase font-bold tracking-wider text-zinc-400">Max Concurrency (Optional)</label>
              <input
                type="number"
                placeholder="Leave empty for global default"
                value={maxConcurrency}
                onChange={(e) => setMaxConcurrency(e.target.value ? Number(e.target.value) : "")}
                className="w-full bg-[#0c0c0e] border border-zinc-800 rounded-lg p-2 text-sm font-mono focus:outline-none focus:border-zinc-500"
                min="1"
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-2 py-2 border border-zinc-800 text-zinc-400 hover:text-white rounded-lg text-sm transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-lg text-sm font-bold bg-white text-black text-zinc-950 shadow-sm border-0 font-medium  hover:bg-zinc-800 transition-colors transition-colors"
            >
              Save Settings
            </button>
          </div>
        </form>
      )}

      {/* Providers list */}
      {loading ? (
        <div className="text-zinc-400 font-mono text-xs">Querying registered servers...</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2 overflow-y-auto no-scrollbar flex-1 min-h-0 pr-2 pb-8">
          {filteredProviders.map((p) => (
            <div key={p.id} className="bg-[#0c0c0e] border border-zinc-800 rounded-xl p-2 space-y-1 flex flex-col justify-between">
              
              <div className="space-y-1.5">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-bold text-white">{p.name}</h3>
                    <span className="text-[10px] bg-[#0c0c0e] text-zinc-400 font-mono px-2 py-0.5 rounded uppercase mt-1 inline-block">
                      {p.type}
                    </span>
                  </div>
                  
                  <span className={`px-2.5 py-0.5 rounded text-[10px] font-bold border ${
                    ((p.process_telemetry ? p.process_telemetry.online : (p.status || p.last_status === "ONLINE")) ? "bg-zinc-900 text-zinc-100 border-zinc-500" :
                    ((p.status || p.last_status) === "OFFLINE" || (p.process_telemetry && !p.process_telemetry.online) ? "bg-zinc-800 text-white border-zinc-800" :
                    "bg-black text-zinc-400 border-zinc-800"))
                  }`}>
                    {(p.process_telemetry ? (p.process_telemetry.online ? "ONLINE" : "OFFLINE") : (p.status || p.last_status || "UNTESTED"))}
                  </span>
                </div>

                <div className="space-y-1 bg-[#0c0c0e]/5 p-2 rounded-lg border border-zinc-800 font-mono text-xs text-zinc-400">
                    <div className="truncate mb-1.5">URL: {p.base_url}</div>
                    
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <span>Max Concurrency:</span>
                      <input 
                        type="number"
                        placeholder={p.max_concurrency ? p.max_concurrency.toString() : "Global default"}
                        value={pendingConcurrency[p.id] !== undefined ? pendingConcurrency[p.id] : ""}
                        onChange={(e) => setPendingConcurrency({...pendingConcurrency, [p.id]: e.target.value})}
                        className="flex-1 bg-[#0c0c0e] border border-zinc-800 rounded px-1.5 py-0.5 text-[10px] focus:outline-none focus:border-zinc-500"
                        min="1"
                      />
                      {pendingConcurrency[p.id] !== undefined && (
                        <button 
                          onClick={() => saveProviderConcurrency(p.id)}
                          className="px-1.5 py-0.5 text-[10px] bg-[#0c0c0e] text-white border border-zinc-800 rounded hover:bg-zinc-800"
                        >
                          Save
                        </button>
                      )}
                    </div>

                    {p.type === "openai_compatible" ? (
                    <div className="flex items-center gap-1.5">
                      <span>Key:</span>
                      <input 
                        type="password"
                        placeholder={p.api_key ? "â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢" : "Paste API Key here"}
                        value={pendingKeys[p.id] !== undefined ? pendingKeys[p.id] : ""}
                        onChange={(e) => setPendingKeys({...pendingKeys, [p.id]: e.target.value})}
                        className="flex-1 bg-[#0c0c0e] border border-zinc-800 rounded px-1.5 py-0.5 text-[10px] focus:outline-none focus:border-zinc-500"
                      />
                      {pendingKeys[p.id] !== undefined && (
                        <button 
                          onClick={() => saveProviderKey(p.id)}
                          className="px-1.5 py-0.5 text-[10px] bg-[#0c0c0e] text-white border border-zinc-800 rounded hover:bg-zinc-800"
                        >
                          Save
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="text-zinc-400 italic mt-2 text-[10px] uppercase tracking-wider">
                      Local Runtime (No API Key Required)
                    </div>
                  )}
                  {(p.error || p.last_error) && (
                    <div className="mt-2 text-[10px] text-zinc-500 font-sans p-2 bg-zinc-800 border border-zinc-800 rounded break-words whitespace-pre-wrap">
                      {p.error || p.last_error}
                    </div>
                  )}
                </div>

                {/* Available models logged */}
                {p.models && p.models.length > 0 && (
                  <div className="space-y-1 mt-1">
                    <div className="text-[9px] text-zinc-400 font-bold uppercase">Available Models ({p.models.length})</div>
                    <div className="flex flex-wrap gap-1.5">
                      {p.models.slice(0, 5).map(m => (
                        <span key={m} className="px-2 py-0.5 bg-[#0c0c0e] border border-zinc-800 text-[10px] text-zinc-400 rounded font-mono">
                          {m}
                        </span>
                      ))}
                      {p.models.length > 5 && (
                        <span className="text-[10px] text-zinc-400 self-center">+{p.models.length - 5} more</span>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Action buttons */}
              <div className="flex gap-2 pt-2 border-t border-zinc-800/80 mt-2">
                <button
                  onClick={() => testConnection(p.id)}
                  disabled={testingId === p.id}
                  className="flex-1 flex items-center justify-center gap-2 px-2 py-1 border border-zinc-800 bg-[#0c0c0e] hover:bg-zinc-900 text-zinc-400 hover:text-white rounded-lg text-xs transition-colors"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${testingId === p.id ? "animate-spin" : ""}`} />
                  {testingId === p.id ? "Testing..." : "Test Connection"}
                </button>
              </div>

            </div>
          ))}
        </div>
      )}
    </div>
  );
}


