"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { 
  Play, 
  ChevronRight, 
  ChevronLeft, 
  Server,
  Activity, 
  Settings, 
  BookOpen, 
  TrendingUp, 
  ShieldAlert,
  HelpCircle,
  Cpu,
  AlertTriangle,
  ShieldCheck,
  Zap
} from "lucide-react";

const API_BASE = "";

interface Provider {
  id: number;
  name: string;
  type: string;
  base_url: string;
  enabled: boolean;
  status?: string;
  models?: string[];
  last_status?: string;
  last_error?: string;
  last_models?: string;
}

interface PromptSuite {
  id: number;
  name: string;
  description: string;
}

export default function NewBenchmark() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [suites, setSuites] = useState<PromptSuite[]>([]);
  const [loadingProviders, setLoadingProviders] = useState(true);
  const [searchProviderQuery, setSearchProviderQuery] = useState("");

  // Form Fields State
  const [runName, setRunName] = useState("Run Comparison - " + new Date().toLocaleString());
  const [modelName, setModelName] = useState("");
  const [revision, setRevision] = useState("latest");
  const [quantization, setQuantization] = useState("INT4");
  const [contextLength, setContextLength] = useState(32768);
  const [parametersSize, setParametersSize] = useState("7B");
  const [architecture, setArchitecture] = useState("Qwen2");
  const [customHardwareProfile, setCustomHardwareProfile] = useState("");

  const [selectedProviders, setSelectedProviders] = useState<number[]>([]);
  const [selectedSuites, setSelectedSuites] = useState<number[]>([]);

  // Evaluation States
  const [benchmarkMode, setBenchmarkMode] = useState("standard");
  const [exactMatchKeyword, setExactMatchKeyword] = useState("");
  const [llmJudgeProviderId, setLlmJudgeProviderId] = useState<number | "">("");
  const [llmJudgeModelName, setLlmJudgeModelName] = useState("");

  // Settings
  const [temperature, setTemperature] = useState(0.0);
  const [topP, setTopP] = useState(1.0);
  const [topK, setTopK] = useState(50);
  const [seed, setSeed] = useState(42);
  const [maxTokens, setMaxTokens] = useState(128);
  const [stopSequences, setStopSequences] = useState("");
  const [useIdenticalSettings, setUseIdenticalSettings] = useState(true);
  const [sequentialExecution, setSequentialExecution] = useState(true);

  // Execution config
  const [warmups, setWarmups] = useState(2);
  const [repetitions, setRepetitions] = useState(3);
  const [concurrency, setConcurrency] = useState(2);
  const [requestRate, setRequestRate] = useState<number | null>(null);
  const [completedRuns, setCompletedRuns] = useState<any[]>([]);
  const [baselineRunId, setBaselineRunId] = useState<number | "">("");
  const [hardwareInfo, setHardwareInfo] = useState<any>(null);

  // Judge LLM config
  const [useJudge, setUseJudge] = useState(false);
  const [judgeProviderId, setJudgeProviderId] = useState<number | null>(null);
  const [judgeModelName, setJudgeModelName] = useState("");

  useEffect(() => {
    const loadWizardData = async () => {
      try {
        // Fetch Providers
        const provRes = await fetch(`${API_BASE}/api/providers`);
        const provs = await provRes.json();
        
        // Load Provider statuses in background
        const activeProvs = provs.filter((p: Provider) => p.enabled);
        setProviders(activeProvs);
        
        // Fetch Prompt Suites
        const suiteRes = await fetch(`${API_BASE}/api/prompts`);
        const suiteData = await suiteRes.json();
        setSuites(suiteData);
        
        // Auto select first suite
        if (suiteData.length > 0) {
          setSelectedSuites([suiteData[0].id]);
        }

        // Fetch completed runs for baseline regression selection
        const runsRes = await fetch(`${API_BASE}/api/runs`);
        const runsData = await runsRes.json();
        if (Array.isArray(runsData)) {
          setCompletedRuns(runsData.filter((r: any) => r.status === "COMPLETED"));
        }

        // Fetch hardware info
        const hwRes = await fetch(`${API_BASE}/api/hardware`);
        const hwData = await hwRes.json();
        setHardwareInfo(hwData);
      } catch (err) {
        console.error("Failed to load wizard sources:", err);
      } finally {
        setLoadingProviders(false);
      }
    };
    loadWizardData();
  }, []);

  // Memory Estimator based on model parameter size and serving runtime
  const estimateMemoryGB = (mName: string, providerType: string): number => {
    const pType = (providerType || "").toLowerCase();
    const name = (mName || "").toLowerCase();
    
    let baseParams = 0.5;
    if (name.includes("70b")) baseParams = 70.0;
    else if (name.includes("32b") || name.includes("34b")) baseParams = 32.0;
    else if (name.includes("14b")) baseParams = 14.0;
    else if (name.includes("8b")) baseParams = 8.0;
    else if (name.includes("7b")) baseParams = 7.0;
    else if (name.includes("3b")) baseParams = 3.0;
    else if (name.includes("1.5b") || name.includes("1b")) baseParams = 1.5;
    else if (name.includes("0.5b")) baseParams = 0.5;

    if (pType.includes("transformers")) {
      return +(baseParams * 2.2 + 0.8).toFixed(1);
    } else if (pType.includes("vllm")) {
      return +(baseParams * 1.3 + 4.5).toFixed(1);
    } else {
      // GGUF Q4 (Ollama, llama.cpp)
      return +(baseParams * 0.75 + 0.5).toFixed(1);
    }
  };

  useEffect(() => {
    if (!modelName) return;
    
    const nameStr = modelName.toLowerCase();
    
    setRevision("latest");
    
    // Parameter Size heuristic
    const paramMatch = nameStr.match(/(\d+(?:\.\d+)?)[bx]/); 
    if (paramMatch) {
      setParametersSize(paramMatch[0].toUpperCase());
    } else {
      setParametersSize("Unknown");
    }

    // Quantization heuristic
    if (nameStr.includes("int4") || nameStr.includes("q4") || nameStr.includes("awq") || nameStr.includes("gptq")) {
      setQuantization("INT4");
    } else if (nameStr.includes("int8") || nameStr.includes("q8")) {
      setQuantization("INT8");
    } else {
      setQuantization("FP16 / BF16 (Default)");
    }

    // Context Length heuristic
    if (nameStr.includes("llama-3.1") || nameStr.includes("llama3.1")) {
      setContextLength(128000);
    } else if (nameStr.includes("llama-3") || nameStr.includes("llama3")) {
      setContextLength(8192);
    } else if (nameStr.includes("qwen2.5")) {
      setContextLength(32768);
    } else if (nameStr.includes("qwen")) {
      setContextLength(32768);
    } else if (nameStr.includes("mistral")) {
      setContextLength(32768);
    } else if (nameStr.includes("mixtral")) {
      setContextLength(32768);
    } else if (nameStr.includes("gemma-2") || nameStr.includes("gemma2")) {
      setContextLength(8192);
    } else if (nameStr.includes("gemma")) {
      setContextLength(8192);
    } else if (nameStr.includes("glm") || nameStr.includes("zhipu")) {
      setContextLength(128000);
    } else if (nameStr.includes("claude-3-5")) {
      setContextLength(200000);
    } else if (nameStr.includes("gpt-4o")) {
      setContextLength(128000);
    } else {
      setContextLength(4096);
    }
  }, [modelName]);

  const handleProviderToggle = (id: number) => {
    setSelectedProviders(prev => 
      prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]
    );
  };

  const handleSuiteToggle = (id: number) => {
    setSelectedSuites(prev => 
      prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]
    );
  };

  const handleLaunch = async () => {
    if (selectedProviders.length === 0) {
      alert("Please select at least one inference provider.");
      return;
    }
    if (selectedSuites.length === 0) {
      alert("Please select at least one prompt suite.");
      return;
    }

    const payload = {
      name: runName,
      config_create: {
        name: runName + " Configuration",
        model_name: modelName,
        model_revision: revision,
        model_quantization: quantization,
        model_context_length: contextLength,
        model_parameters: parametersSize,
        model_architecture: architecture,
        temperature: temperature,
        top_p: topP,
        top_k: topK,
        seed: seed,
        max_tokens: maxTokens,
        stop_sequences: stopSequences || null,
        repetitions: repetitions,
        warmup_requests: warmups,
        concurrency: concurrency,
        request_rate: requestRate,
        use_identical_settings: useIdenticalSettings
      },
      provider_ids: selectedProviders,
      prompt_suite_ids: selectedSuites,
      llm_judge_provider_id: useJudge ? judgeProviderId : null,
      llm_judge_model_name: useJudge ? judgeModelName : null,
      baseline_run_id: baselineRunId || null,
      sequential_execution: sequentialExecution,
      custom_hardware_profile: customHardwareProfile || null
    };

    try {
      const res = await fetch(`${API_BASE}/api/benchmarks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        const runData = await res.json();
        router.push(`/benchmarks/${runData.id}`);
      } else {
        const err = await res.json();
        alert("Failed to queue benchmark: " + (err.detail || res.statusText));
      }
    } catch (err) {
      console.error(err);
      alert("Error connection mapping.");
    }
  };
  // Helper to get models for a provider, either live or cached
  const getProviderModels = (p: Provider): string[] => {
    if (p.models) return p.models;
    if (p.last_models) {
      try {
        return JSON.parse(p.last_models);
      } catch (e) {
        return [];
      }
    }
    return [];
  };

  const isProviderLocal = (p: Provider) => p.name.toLowerCase().includes("local") || p.base_url.includes("127.0.0.1") || p.base_url === "local" || p.base_url.includes("localhost");

  const localModels = Array.from(new Set(
    providers
      .filter(p => (p.status === "ONLINE" || p.last_status === "ONLINE") && isProviderLocal(p))
      .flatMap(getProviderModels)
  )).sort();

  const cloudModels = Array.from(new Set(
    providers
      .filter(p => (p.status === "ONLINE" || p.last_status === "ONLINE") && !isProviderLocal(p))
      .flatMap(getProviderModels)
  )).sort();

  const filteredProviders = providers.filter(p => {
    const isOnline = p.status === "ONLINE" || p.last_status === "ONLINE";
    if (!isOnline) return false;

    const matchesSearch = p.name.toLowerCase().includes(searchProviderQuery.toLowerCase()) || 
      p.type.toLowerCase().includes(searchProviderQuery.toLowerCase()) ||
      p.base_url.toLowerCase().includes(searchProviderQuery.toLowerCase());
      
    if (!matchesSearch) return false;

    // If models list is fetched and available, ensure the provider supports the selected model.
    // Local runtimes might not have a strict models list, so fallback to true if undefined.
    const modelsList = getProviderModels(p);
    const hasModel = modelsList.length > 0 ? modelsList.includes(modelName) : true;
    
    return isProviderLocal(p) ? true : hasModel;
  });

  return (
    <div className="p-2 space-y-2 flex-1 h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div>
        <h1 className="text-sm font-bold tracking-tight">Create Experiment</h1>
        <p className="text-zinc-400 text-sm mt-1">Benchmarking wizard for testing identical models and configurations fairly.</p>
      </div>

      {/* Step Indicators */}
      <div className="flex items-center gap-2 border-b border-zinc-800 pb-4">
        {[
          { num: 1, label: "Model" },
          { num: 2, label: "Providers" },
          { num: 3, label: "Settings" },
          { num: 4, label: "Prompts" },
          { num: 5, label: "LLM Judge" }
        ].map((s) => (
          <React.Fragment key={s.num}>
            <div className={`flex items-center gap-2 px-3 py-1 rounded text-sm ${
              step === s.num ? "bg-[#0c0c0e] text-white font-bold border border-zinc-800" :
              step > s.num ? "text-zinc-100" : "text-zinc-400"
            }`}>
              <span className="w-5 h-5 rounded-full bg-[#0c0c0e] flex items-center justify-center text-xs font-mono">
                {s.num}
              </span>
              <span>{s.label}</span>
            </div>
            {s.num < 5 && <ChevronRight className="h-4 w-4 text-zinc-500" />}
          </React.Fragment>
        ))}
      </div>

      {/* Form Steps */}
      <div className="bg-[#0c0c0e] border border-zinc-800 rounded-xl p-2 min-h-[380px] flex flex-col justify-between">
        
        {/* STEP 1: MODEL SELECTION */}
        {step === 1 && (
          <div className="space-y-2 flex-1 flex flex-col min-h-0 overflow-hidden">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <Settings className="h-5 w-5 text-white" />
              Configure Target Model
            </h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 flex-none">
              <div className="space-y-1.5 col-span-1 md:col-span-2">
                <label className="text-xs uppercase font-bold tracking-wider text-zinc-400">Benchmark Run Name</label>
                <input 
                  type="text" 
                  value={runName} 
                  onChange={(e) => setRunName(e.target.value)} 
                  className="w-full bg-[#0c0c0e] border border-zinc-800 rounded-lg p-2.5 text-sm font-sans focus:outline-none focus:border-zinc-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs uppercase font-bold tracking-wider text-zinc-100 flex items-center gap-1">
                  <Server className="w-3 h-3" />
                  Local Downloaded Models
                </label>
                <input 
                  type="text" 
                  list="local-models"
                  value={modelName} 
                  onChange={(e) => setModelName(e.target.value)} 
                  className="w-full bg-[#0c0c0e] border border-zinc-500 rounded-lg p-2.5 text-sm font-mono focus:outline-none focus:border-zinc-500"
                  placeholder="Search downloaded local models..."
                />
                <datalist id="local-models">
                  {localModels.map(m => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </div>
              
              <div className="space-y-1.5">
                <label className="text-xs uppercase font-bold tracking-wider text-white flex items-center gap-1">
                  <Activity className="w-3 h-3" />
                  Cloud API Models
                </label>
                <input 
                  type="text" 
                  list="cloud-models"
                  value={modelName} 
                  onChange={(e) => setModelName(e.target.value)} 
                  className="w-full bg-[#0c0c0e] border border-white rounded-lg p-2.5 text-sm font-mono focus:outline-none focus:border-white"
                  placeholder="Search cloud models..."
                />
                <datalist id="cloud-models">
                  {cloudModels.map(m => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs uppercase font-bold tracking-wider text-zinc-400">Model Revision</label>
                <input 
                  type="text" 
                  value={revision} 
                  onChange={(e) => setRevision(e.target.value)} 
                  className="w-full bg-[#0c0c0e] border border-zinc-800 rounded-lg p-2.5 text-sm focus:outline-none focus:border-zinc-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs uppercase font-bold tracking-wider text-zinc-400">Quantization (e.g. GGUF Q4, FP16)</label>
                <input 
                  type="text" 
                  value={quantization} 
                  onChange={(e) => setQuantization(e.target.value)} 
                  className="w-full bg-[#0c0c0e] border border-zinc-800 rounded-lg p-2.5 text-sm focus:outline-none focus:border-zinc-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs uppercase font-bold tracking-wider text-zinc-400">Parameters Size (e.g. 7B, 13B)</label>
                <input 
                  type="text" 
                  value={parametersSize} 
                  onChange={(e) => setParametersSize(e.target.value)} 
                  className="w-full bg-[#0c0c0e] border border-zinc-800 rounded-lg p-2.5 text-sm focus:outline-none focus:border-zinc-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs uppercase font-bold tracking-wider text-zinc-400">Context Window Size</label>
                <input 
                  type="number" 
                  value={contextLength} 
                  onChange={(e) => setContextLength(parseInt(e.target.value))} 
                  className="w-full bg-[#0c0c0e] border border-zinc-800 rounded-lg p-2.5 text-sm focus:outline-none focus:border-zinc-500"
                />
              </div>
            </div>
            <div className="space-y-1.5 pt-4 border-t border-zinc-800/80">
              <label className="text-xs uppercase font-bold tracking-wider text-zinc-400">Custom Hardware Profile (Optional)</label>
              <input 
                type="text" 
                value={customHardwareProfile} 
                onChange={(e) => setCustomHardwareProfile(e.target.value)} 
                className="w-full bg-[#0c0c0e] border border-zinc-800 rounded-lg p-2.5 text-sm focus:outline-none focus:border-white text-white"
                placeholder="e.g., MacBook Pro M3 Max 128GB, or dual RTX 3090s"
              />
              <p className="text-xs text-zinc-500">Document the client/runner machine specs for the report (overrides automatic hardware detection).</p>
            </div>
          </div>
        )}


        {/* STEP 2: PROVIDERS SELECTION */}
        {step === 2 && (
          <div className="space-y-2 flex-1 flex flex-col min-h-0 overflow-hidden">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Server className="h-5 w-5 text-white" />
                Select Inference Runtimes
              </h3>
              <div className="w-64">
                <input 
                  type="text" 
                  placeholder="Search runtime/provider..."
                  value={searchProviderQuery} 
                  onChange={(e) => setSearchProviderQuery(e.target.value)} 
                  className="w-full bg-[#0c0c0e] border border-zinc-800 rounded-lg px-3 py-1.5 text-xs font-sans focus:outline-none focus:border-zinc-500"
                />
              </div>
            </div>

            {loadingProviders ? (
              <div className="text-zinc-400">Checking local configurations...</div>
            ) : providers.length === 0 ? (
              <div className="text-zinc-400 text-sm">No active providers found. Add providers in Settings first.</div>
            ) : filteredProviders.length === 0 ? (
              <div className="text-xs text-zinc-400 font-mono py-8 text-center border border-dashed border-zinc-800 rounded-xl">
                No active runtimes found matching "{searchProviderQuery}"
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-1 max-h-[350px] overflow-y-auto pr-1">
                {filteredProviders.map((p) => (
                  <div 
                    key={p.id}
                    onClick={() => handleProviderToggle(p.id)}
                    className={`border p-4 rounded-xl cursor-pointer transition-all flex flex-col justify-between ${
                      selectedProviders.includes(p.id) ? "border-zinc-500 bg-[#0c0c0e]/10" : "border-zinc-800 hover:border-zinc-800 bg-black/30"
                    }`}
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <h4 className="font-semibold text-white">{p.name}</h4>
                        <span className="text-[10px] bg-[#0c0c0e] text-zinc-400 px-2 py-0.5 rounded uppercase font-mono mt-1 inline-block">
                          {p.type}
                        </span>
                      </div>
                      <input 
                        type="checkbox" 
                        checked={selectedProviders.includes(p.id)}
                        onChange={() => {}} // toggled on card click
                        className="rounded border-white text-white focus:ring-cyan-500"
                      />
                    </div>
                    
                    <div className="flex justify-between items-center text-xs mt-4 text-zinc-400 border-t border-zinc-800/80 pt-2 font-mono">
                      <span className="truncate max-w-[200px]" title={p.base_url}>{p.base_url}</span>
                      <span className={
                        p.status === "ONLINE" ? "text-zinc-100 font-semibold" :
                        p.status === "OFFLINE" ? "text-white font-semibold" : "text-zinc-400 animate-pulse"
                      }>
                        ● {p.status || "Checking"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* STEP 3: HYPERPARAMETERS & RATE SETTINGS */}
        {step === 3 && (
          <div className="space-y-2 flex-1 flex flex-col min-h-0 overflow-hidden">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-white" />
              Generation & Execution Settings
            </h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 flex-none">
              <div className="space-y-1">
                <label className="text-xs uppercase font-bold tracking-wider text-zinc-400">Temperature</label>
                <div className="flex items-center gap-3">
                  <input 
                    type="range" min="0" max="2" step="0.1" 
                    value={temperature} 
                    onChange={(e) => setTemperature(parseFloat(e.target.value))} 
                    className="flex-1 accent-cyan-500"
                  />
                  <span className="text-xs font-mono text-white w-8">{temperature.toFixed(1)}</span>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs uppercase font-bold tracking-wider text-zinc-400">Top P</label>
                <div className="flex items-center gap-3">
                  <input 
                    type="range" min="0" max="1" step="0.05" 
                    value={topP} 
                    onChange={(e) => setTopP(parseFloat(e.target.value))} 
                    className="flex-1 accent-cyan-500"
                  />
                  <span className="text-xs font-mono text-white w-8">{topP.toFixed(2)}</span>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs uppercase font-bold tracking-wider text-zinc-400">Max Output Tokens</label>
                <input 
                  type="number" 
                  value={maxTokens} 
                  onChange={(e) => setMaxTokens(parseInt(e.target.value))} 
                  className="w-full bg-[#0c0c0e] border border-zinc-800 rounded-lg p-2 text-sm focus:outline-none focus:border-zinc-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs uppercase font-bold tracking-wider text-zinc-400">Seed</label>
                <input 
                  type="number" 
                  value={seed} 
                  onChange={(e) => setSeed(parseInt(e.target.value))} 
                  className="w-full bg-[#0c0c0e] border border-zinc-800 rounded-lg p-2 text-sm focus:outline-none focus:border-zinc-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs uppercase font-bold tracking-wider text-zinc-400">Concurrency (Simultaneous requests)</label>
                <select 
                  value={concurrency} 
                  onChange={(e) => setConcurrency(parseInt(e.target.value))}
                  className="w-full bg-[#0c0c0e] border border-zinc-800 rounded-lg p-2 text-sm focus:outline-none focus:border-zinc-500"
                >
                  <option value={1}>1 (Sequential)</option>
                  <option value={2}>2</option>
                  <option value={4}>4</option>
                  <option value={8}>8</option>
                  <option value={16}>16</option>
                  <option value={32}>32</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs uppercase font-bold tracking-wider text-zinc-400">Repetitions (Sample size)</label>
                <input 
                  type="number" 
                  value={repetitions} 
                  onChange={(e) => setRepetitions(parseInt(e.target.value))} 
                  className="w-full bg-[#0c0c0e] border border-zinc-800 rounded-lg p-2 text-sm focus:outline-none focus:border-zinc-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs uppercase font-bold tracking-wider text-zinc-400">Warm-up Requests</label>
                <input 
                  type="number" 
                  value={warmups} 
                  onChange={(e) => setWarmups(parseInt(e.target.value))} 
                  className="w-full bg-[#0c0c0e] border border-zinc-800 rounded-lg p-2 text-sm focus:outline-none focus:border-zinc-500"
                />
              </div>

              {/* Regression Baseline Selection */}
              <div className="space-y-1.5 md:col-span-2 bg-zinc-900/50 border border-zinc-800 p-3 rounded-xl">
                <div className="flex items-center justify-between">
                  <label className="text-xs uppercase font-bold tracking-wider text-blue-400 flex items-center gap-1.5">
                    <TrendingUp className="w-3.5 h-3.5" />
                    Regression Benchmark Baseline (Optional)
                  </label>
                  <span className="text-[10px] text-zinc-500">Auto-links comparison matrix</span>
                </div>
                <select
                  value={baselineRunId}
                  onChange={(e) => setBaselineRunId(e.target.value ? parseInt(e.target.value) : "")}
                  className="w-full bg-[#0c0c0e] border border-zinc-800 rounded-lg p-2 text-xs text-zinc-200 focus:outline-none focus:border-blue-500"
                >
                  <option value="">None (Standard Standalone Benchmark)</option>
                  {completedRuns.map((r: any) => (
                    <option key={r.id} value={r.id}>
                      Run #{r.id}: {r.name} ({new Date(r.created_at).toLocaleDateString()})
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-zinc-400 mt-1">
                  Selecting a baseline will calculate regression & improvement deltas (Δ) for throughput, TTFT, and quality.
                </p>
              </div>

              {/* GPU Hardware Detection & Memory Footprint Card */}
              {(() => {
                const detectedGpu = hardwareInfo?.live?.gpu_utilization?.[0] || hardwareInfo?.static?.gpus?.[0];
                const detectedGpuName = detectedGpu?.name || (hardwareInfo?.static?.cpu_model ? `CPU Mode (${hardwareInfo.static.cpu_model})` : "Standard GPU / CPU");
                const detectedGpuVRAMBytes = detectedGpu?.vram_total || 0;
                const detectedGpuVRAMGB = detectedGpuVRAMBytes > 0 ? +(detectedGpuVRAMBytes / (1024 ** 3)).toFixed(1) : 6.0;
                const detectedFreeVRAMGB = detectedGpu?.vram_used ? +((detectedGpuVRAMBytes - detectedGpu.vram_used) / (1024 ** 3)).toFixed(1) : detectedGpuVRAMGB;

                const selectedProvObjects = providers.filter(p => selectedProviders.includes(p.id));
                const selectedMemories = selectedProvObjects.map(p => estimateMemoryGB(modelName, p.type));
                const totalSimultaneousGB = +selectedMemories.reduce((a, b) => a + b, 0).toFixed(1);
                const peakSequentialGB = selectedMemories.length > 0 ? Math.max(...selectedMemories) : 0;
                const activeRequiredGB = sequentialExecution ? peakSequentialGB : totalSimultaneousGB;
                const isMemoryOverflow = !sequentialExecution && totalSimultaneousGB > detectedGpuVRAMGB && selectedProviders.length > 1;

                return (
                  <div className="md:col-span-2 bg-[#0e0e12] border border-zinc-800 rounded-xl p-3 space-y-2.5 shadow-sm mt-2">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-zinc-800/80 pb-2">
                      <div className="flex items-center gap-2">
                        <div className="p-1.5 bg-blue-500/10 border border-blue-500/20 rounded-lg text-blue-400">
                          <Cpu className="h-4 w-4" />
                        </div>
                        <div>
                          <div className="text-xs font-bold text-white flex items-center gap-2">
                            <span>Hardware Detected:</span>
                            <span className="font-mono text-blue-300 font-semibold">{detectedGpuName}</span>
                          </div>
                          <p className="text-[10px] text-zinc-400 font-mono">
                            Total VRAM: <span className="text-white font-bold">{detectedGpuVRAMGB} GB</span> | Free Available: <span className="text-emerald-400 font-bold">{detectedFreeVRAMGB} GB</span>
                          </p>
                        </div>
                      </div>

                      {/* Execution Strategy Toggle Buttons */}
                      <div className="flex items-center gap-1.5 bg-zinc-900/90 p-1 rounded-lg border border-zinc-800">
                        <button
                          type="button"
                          onClick={() => setSequentialExecution(true)}
                          className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
                            sequentialExecution 
                              ? 'bg-emerald-600 text-white shadow-sm font-bold' 
                              : 'text-zinc-400 hover:text-white'
                          }`}
                        >
                          <ShieldCheck className="h-3.5 w-3.5" />
                          Sequential (Safe)
                        </button>
                        <button
                          type="button"
                          onClick={() => setSequentialExecution(false)}
                          className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
                            !sequentialExecution 
                              ? 'bg-amber-600 text-white shadow-sm font-bold' 
                              : 'text-zinc-400 hover:text-white'
                          }`}
                        >
                          <Zap className="h-3.5 w-3.5" />
                          Simultaneous (Parallel)
                        </button>
                      </div>
                    </div>

                    {/* Memory Footprint Progress Bar */}
                    <div className="space-y-1">
                      <div className="flex justify-between text-[10px] font-mono">
                        <span className="text-zinc-400">
                          {sequentialExecution ? "Peak Single-Model VRAM" : "Total Parallel VRAM Footprint"}: 
                          <span className={`ml-1 font-bold ${isMemoryOverflow ? 'text-red-400' : 'text-white'}`}>
                            ~{activeRequiredGB} GB
                          </span>
                        </span>
                        <span className="text-zinc-400">
                          GPU Ceiling: <span className="text-zinc-200">{detectedGpuVRAMGB} GB</span>
                        </span>
                      </div>
                      <div className="w-full bg-zinc-900 rounded-full h-2 overflow-hidden border border-zinc-800">
                        <div 
                          className={`h-full transition-all duration-300 ${
                            isMemoryOverflow 
                              ? 'bg-red-500' 
                              : activeRequiredGB / detectedGpuVRAMGB > 0.8 
                                ? 'bg-amber-500' 
                                : 'bg-emerald-500'
                          }`}
                          style={{ width: `${Math.min(100, Math.round((activeRequiredGB / detectedGpuVRAMGB) * 100))}%` }}
                        />
                      </div>
                    </div>

                    {/* VRAM Overflow Warning Card */}
                    {isMemoryOverflow && (
                      <div className="bg-red-950/40 border border-red-500/50 rounded-lg p-2.5 flex items-start justify-between gap-3 text-xs text-red-200">
                        <div className="flex items-start gap-2">
                          <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
                          <div className="space-y-0.5">
                            <span className="font-bold text-red-300 uppercase tracking-wider text-[10px]">
                              ⚠️ GPU Memory Collapse / OOM Risk
                            </span>
                            <p className="text-[11px] text-red-200 leading-tight">
                              Running {selectedProviders.length} engines simultaneously with <strong>{modelName || 'selected models'}</strong> requires an estimated <strong>~{totalSimultaneousGB} GB VRAM</strong>, which exceeds your GPU capacity (<strong>{detectedGpuVRAMGB} GB</strong>). 
                              Servers may crash, run out of memory (CUDA OOM), or suffer severe CPU paging slowdowns.
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setSequentialExecution(true)}
                          className="shrink-0 bg-red-600 hover:bg-red-500 text-white font-bold text-[10px] px-2.5 py-1.5 rounded uppercase tracking-wider transition-colors cursor-pointer"
                        >
                          Switch to Sequential Mode
                        </button>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
        )}

        {/* STEP 4: PROMPT SUITES SELECTION */}
        {step === 4 && (
          <div className="space-y-2 flex-1 flex flex-col min-h-0 overflow-hidden">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <BookOpen className="h-5 w-5 text-white" />
              Select Test Prompt Suites
            </h3>

            <div className="space-y-3">
              {suites.map((s) => (
                <div 
                  key={s.id}
                  onClick={() => handleSuiteToggle(s.id)}
                  className={`border p-4 rounded-xl cursor-pointer transition-all flex justify-between items-center ${
                    selectedSuites.includes(s.id) ? "border-zinc-500 bg-[#0c0c0e]/10" : "border-zinc-800 hover:border-zinc-800 bg-black/30"
                  }`}
                >
                  <div className="space-y-1">
                    <h4 className="font-semibold text-white">{s.name}</h4>
                    <p className="text-xs text-zinc-400">{s.description}</p>
                  </div>
                  <input 
                    type="checkbox" 
                    checked={selectedSuites.includes(s.id)}
                    onChange={() => {}} // toggled on container click
                    className="rounded border-white text-white focus:ring-cyan-500"
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* STEP 5: LLM JUDGE */}
        {step === 5 && (
          <div className="space-y-2 flex-1 flex flex-col min-h-0 overflow-hidden">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-white" />
              Configure LLM-as-a-Judge Evaluation (Optional)
            </h3>

            <div className="bg-transparent border border-zinc-800 rounded-xl p-5 space-y-1">
              <div className="flex items-center gap-3">
                <input 
                  type="checkbox" 
                  id="enable_judge"
                  checked={useJudge}
                  onChange={(e) => setUseJudge(e.target.checked)}
                  className="rounded border-white text-white focus:ring-cyan-500"
                />
                <label htmlFor="enable_judge" className="text-sm font-semibold text-white cursor-pointer">
                  Activate automatic semantic LLM Judge scoring
                </label>
              </div>

              {useJudge && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-1 pt-4 border-t border-zinc-800/80">
                  <div className="space-y-1.5">
                    <label className="text-xs uppercase font-bold tracking-wider text-zinc-400">Judge Provider</label>
                    <select 
                      value={judgeProviderId || ""} 
                      onChange={(e) => setJudgeProviderId(parseInt(e.target.value))}
                      className="w-full bg-[#0c0c0e] border border-zinc-800 rounded-lg p-2 text-sm focus:outline-none focus:border-zinc-500"
                    >
                      <option value="">Select Provider...</option>
                      {providers.map(p => (
                        <option key={p.id} value={p.id}>{p.name} ({p.type})</option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs uppercase font-bold tracking-wider text-zinc-400">Judge Model Name</label>
                    <input 
                      type="text" 
                      placeholder="e.g. qwen3-8b"
                      value={judgeModelName} 
                      onChange={(e) => setJudgeModelName(e.target.value)} 
                      className="w-full bg-[#0c0c0e] border border-zinc-800 rounded-lg p-2 text-sm font-mono focus:outline-none focus:border-zinc-500"
                    />
                  </div>
                </div>
              )}
            </div>
            
            <p className="text-xs text-zinc-400 leading-relaxed">
              When enabled, a separate inference endpoint evaluates generated answers against targets and assigns a normalized quality score. 
              The judge runtime should be isolated from the system configuration currently under benchmark test.
            </p>
          </div>
        )}

        {/* Wizard Controls */}
        <div className="flex justify-between items-center border-t border-zinc-800 pt-6 mt-8">
          <div>
            {step > 1 && (
              <button 
                type="button" 
                onClick={() => setStep(prev => prev - 1)}
                className="flex items-center gap-2 px-2 py-2 border border-zinc-800 bg-black text-zinc-400 hover:text-white rounded-lg text-sm transition-colors"
              >
                <ChevronLeft className="h-4 w-4" />
                Previous
              </button>
            )}
          </div>
          <div>
            {step < 5 ? (
              <button 
                type="button" 
                onClick={() => setStep(prev => prev + 1)}
                className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold bg-white text-black text-zinc-950 shadow-sm border-0 font-medium  hover:bg-zinc-800 transition-colors transition-colors"
              >
                Next Step
                <ChevronRight className="h-4 w-4" />
              </button>
            ) : (
              <button 
                type="button" 
                onClick={handleLaunch}
                className="flex items-center gap-2 px-2 py-2 rounded-lg text-sm font-bold bg-zinc-700  hover:bg-zinc-900 transition-colors"
              >
                <Play className="h-4 w-4 fill-white " />
                Execute Benchmark
              </button>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}

