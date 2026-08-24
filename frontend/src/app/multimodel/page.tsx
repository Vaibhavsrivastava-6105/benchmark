'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { 
  Play, 
  Server, 
  Cpu, 
  BookOpen,
  Layers,
  Zap,
  CheckCircle2,
  Plus,
  Trash2,
  ChevronRight,
  AlertTriangle,
  ShieldCheck,
  Sliders,
  HardDrive,
  Activity
} from 'lucide-react';

export default function MultiModelMatrixPage() {
  const router = useRouter();
  
  const [providers, setProviders] = useState<any[]>([]);
  const [models, setModels] = useState<any[]>([]);
  const [suites, setSuites] = useState<any[]>([]);
  const [hardwareInfo, setHardwareInfo] = useState<any>(null);
  
  // Explicit targets: {provider_id, model_name}
  const [targets, setTargets] = useState<{provider_id: number, model_name: string}[]>([]);
  const [selectedSuites, setSelectedSuites] = useState<number[]>([]);
  const [sequentialExecution, setSequentialExecution] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch('/api/providers').then(r => r.json()),
      fetch('/api/models').then(r => r.json()),
      fetch('/api/prompts').then(r => r.json()),
      fetch('/api/hardware').then(r => r.json()).catch(() => null),
    ]).then(([provData, modData, suiteData, hwData]) => {
      setProviders(provData || []);
      setModels(modData || []);
      setHardwareInfo(hwData || null);
      
      const parsedSuites = Array.isArray(suiteData) ? suiteData : [];
      setSuites(parsedSuites);
      if (parsedSuites.length > 0) {
        setSelectedSuites([parsedSuites[0].id]);
      }
      
      // Default to 1 active target
      if (provData && provData.length > 0) {
         const p = provData[0];
         let firstM = modData && modData.length > 0 ? modData[0].name : '';
         if (p.last_models) {
             try {
                 const arr = JSON.parse(p.last_models);
                 if (arr.length > 0) firstM = arr[0];
             } catch(e) {}
         }
         setTargets([{ provider_id: p.id, model_name: firstM }]);
      }
    }).catch(err => {
      console.error('Failed to load matrix configuration options:', err);
    }).finally(() => {
      setLoading(false);
    });
  }, []);

  // Memory Estimator based on model parameter size, quantization, and serving runtime
  const estimateMemoryGB = (modelName: string, providerId: number): number => {
    const prov = providers.find(p => p.id === providerId);
    const pType = (prov?.type || "").toLowerCase();
    const name = (modelName || "").toLowerCase();
    
    // Check model registry metadata
    const modelRecord = models.find(m => m.name.toLowerCase() === name || name.includes(m.name.toLowerCase()));
    
    let baseParams = 0.5;
    if (modelRecord?.parameters) {
      const pm = modelRecord.parameters.match(/(\d+(?:\.\d+)?)/);
      if (pm) baseParams = parseFloat(pm[0]);
    } else {
      if (name.includes("671b")) baseParams = 671.0;
      else if (name.includes("70b")) baseParams = 70.0;
      else if (name.includes("32b") || name.includes("34b")) baseParams = 32.0;
      else if (name.includes("27b")) baseParams = 27.0;
      else if (name.includes("15b")) baseParams = 15.0;
      else if (name.includes("14b") || name.includes("13b")) baseParams = 14.0;
      else if (name.includes("8b")) baseParams = 8.0;
      else if (name.includes("7b")) baseParams = 7.0;
      else if (name.includes("3b")) baseParams = 3.0;
      else if (name.includes("1.5b") || name.includes("1b")) baseParams = 1.5;
      else if (name.includes("0.5b")) baseParams = 0.5;
    }

    const isInt4 = name.includes("q4") || name.includes("int4") || name.includes("awq") || (modelRecord?.quantization && modelRecord.quantization.toLowerCase().includes("int4"));
    const isInt8 = name.includes("q8") || name.includes("int8") || (modelRecord?.quantization && modelRecord.quantization.toLowerCase().includes("int8"));

    if (pType.includes("transformers")) {
      const mult = isInt4 ? 0.9 : isInt8 ? 1.4 : 2.2;
      return +(baseParams * mult + 1.2).toFixed(1);
    } else if (pType.includes("vllm")) {
      const mult = isInt4 ? 0.75 : 1.5;
      return +(baseParams * mult + 4.0).toFixed(1);
    } else {
      // GGUF Q4 (Ollama, llama.cpp)
      const mult = isInt8 ? 1.1 : isInt4 ? 0.65 : 0.75;
      return +(baseParams * mult + 0.6).toFixed(1);
    }
  };

  // GPU & Memory Aggregates
  const detectedGpu = hardwareInfo?.live?.gpu_utilization?.[0] || hardwareInfo?.static?.gpus?.[0];
  const detectedGpuName = detectedGpu?.name || (hardwareInfo?.static?.cpu_model ? `CPU Mode (${hardwareInfo.static.cpu_model})` : "Standard GPU / CPU");
  const detectedGpuVRAMBytes = detectedGpu?.vram_total || 0;
  const detectedGpuVRAMGB = detectedGpuVRAMBytes > 0 ? +(detectedGpuVRAMBytes / (1024 ** 3)).toFixed(1) : 6.0;
  const detectedFreeVRAMGB = detectedGpu?.vram_used ? +((detectedGpuVRAMBytes - detectedGpu.vram_used) / (1024 ** 3)).toFixed(1) : detectedGpuVRAMGB;

  const targetMemories = targets.map(t => estimateMemoryGB(t.model_name, t.provider_id));
  const totalSimultaneousGB = +targetMemories.reduce((a, b) => a + b, 0).toFixed(1);
  const peakSequentialGB = targetMemories.length > 0 ? Math.max(...targetMemories) : 0;
  const activeRequiredGB = sequentialExecution ? peakSequentialGB : totalSimultaneousGB;
  const isMemoryOverflow = !sequentialExecution && totalSimultaneousGB > detectedGpuVRAMGB;
  const overflowDiffGB = +(totalSimultaneousGB - detectedGpuVRAMGB).toFixed(1);

  const handleRun = async () => {
    if (targets.length === 0 || !selectedSuites.length) {
      alert('Please configure at least one target pairing and one task suite.');
      return;
    }
    
    setIsSubmitting(true);
    
    const uniqueProvIds = Array.from(new Set(targets.map(t => t.provider_id)));
    const uniqueModNames = Array.from(new Set(targets.map(t => t.model_name)));

    const payload = {
      name: `Explicit Pairings: ${targets.length} Targets (${sequentialExecution ? 'Sequential' : 'Simultaneous'})`,
      provider_ids: uniqueProvIds,
      prompt_suite_ids: selectedSuites,
      model_names: uniqueModNames,
      targets: targets,
      benchmark_mode: 'standard',
      sequential_execution: sequentialExecution,
      config_create: {
        name: 'Matrix Auto-Config',
        temperature: 0.0,
        top_p: 1.0,
        top_k: 50,
        seed: 42,
        max_tokens: 256,
        repetitions: 1,
        warmup_requests: 1,
        concurrency: 1
      }
    };

    try {
      const res = await fetch('/api/benchmarks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        const run = await res.json();
        router.push(`/benchmarks/${run.id}`);
      } else {
        alert('Failed to start matrix run.');
      }
    } catch (e) {
      console.error(e);
      alert('Error starting matrix run.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const uniqueModelNames = Array.from(new Set(models.map(m => m.name)));

  const addTarget = () => {
    // Pick the next provider in list for easy multi-interface pairing
    const nextProvIndex = targets.length % (providers.length || 1);
    const prov = providers[nextProvIndex] || providers[0];
    
    let availModels: string[] = [];
    if (prov && prov.last_models) {
        try { availModels = JSON.parse(prov.last_models); } catch(e) {}
    }
    const combined = Array.from(new Set([...availModels, ...uniqueModelNames])).filter(Boolean);
    const firstModel = combined[0] || '';

    setTargets([...targets, { 
      provider_id: prov?.id || 0, 
      model_name: firstModel 
    }]);
  };

  const removeTarget = (index: number) => {
    setTargets(targets.filter((_, i) => i !== index));
  };

  const updateTarget = (index: number, field: 'provider_id'|'model_name', value: any) => {
    const newTargets = [...targets];
    newTargets[index] = { ...newTargets[index], [field]: value };
    
    // Auto-select first model when provider changes if current model not applicable
    if (field === 'provider_id') {
       const p = providers.find(prov => prov.id === value);
       let availModels: string[] = [];
       if (p && p.last_models) {
           try { availModels = JSON.parse(p.last_models); } catch(e) {}
       }
       const combined = Array.from(new Set([...availModels, ...uniqueModelNames])).filter(Boolean);
       if (combined && combined.length > 0 && !combined.includes(newTargets[index].model_name)) {
           newTargets[index].model_name = combined[0];
       }
    }
    
    setTargets(newTargets);
  };

  return (
    <div className="p-3 space-y-3 flex-1 h-full flex flex-col overflow-y-auto pr-1">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-zinc-800/80 pb-3">
        <div className="p-2.5 bg-zinc-900 border border-zinc-800 rounded-xl text-zinc-200">
          <Layers className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-sm font-bold tracking-tight text-white flex items-center gap-2">
            Multi-Model Matrix Target Pairings
            <span className="px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-300 text-[10px] font-mono font-medium border border-zinc-700">
              Matrix Mode
            </span>
          </h1>
          <p className="text-zinc-400 text-xs mt-0.5">Explicitly pair a specific Model with an Inference Runtime to benchmark them head-to-head.</p>
        </div>
      </div>

      {/* GPU Detection & VRAM Status Bar */}
      <div className={`bg-[#0e0e12] border rounded-xl p-3.5 space-y-3 shadow-md transition-all ${
        isMemoryOverflow 
          ? 'border-red-500/80 bg-red-950/20 shadow-[0_0_25px_rgba(239,68,68,0.15)]' 
          : 'border-zinc-800'
      }`}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-zinc-800/80 pb-2.5">
          <div className="flex items-center gap-2.5">
            <div className={`p-2 rounded-lg border ${
              isMemoryOverflow 
                ? 'bg-red-500/20 border-red-500/40 text-red-400 animate-pulse' 
                : 'bg-blue-500/10 border-blue-500/20 text-blue-400'
            }`}>
              <Cpu className="h-4 w-4" />
            </div>
            <div>
              <div className="text-xs font-bold text-white flex items-center gap-2">
                <span>Detected GPU:</span>
                <span className="font-mono text-blue-300 font-semibold">{detectedGpuName}</span>
              </div>
              <p className="text-[11px] text-zinc-400 font-mono mt-0.5">
                GPU Space: <span className="text-white font-bold">{detectedGpuVRAMGB} GB VRAM</span> | Currently Free: <span className="text-emerald-400 font-bold">{detectedFreeVRAMGB} GB</span>
              </p>
            </div>
          </div>

          {/* Strategy Mode Toggle Buttons */}
          <div className="flex items-center gap-1.5 bg-zinc-900/90 p-1 rounded-lg border border-zinc-800">
            <button
              onClick={() => setSequentialExecution(true)}
              className={`px-3 py-1.5 rounded-md text-[11px] font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
                sequentialExecution 
                  ? 'bg-emerald-600 text-white shadow-sm font-bold' 
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              Sequential (Safe)
            </button>
            <button
              onClick={() => setSequentialExecution(false)}
              className={`px-3 py-1.5 rounded-md text-[11px] font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
                !sequentialExecution 
                  ? isMemoryOverflow ? 'bg-red-600 text-white font-bold shadow-[0_0_15px_rgba(239,68,68,0.5)]' : 'bg-amber-600 text-white shadow-sm font-bold' 
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              <Zap className="h-3.5 w-3.5" />
              Simultaneous (Parallel)
            </button>
          </div>
        </div>

        {/* Memory Footprint Bar & Breakdown */}
        <div className="space-y-1.5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-[11px] font-mono">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-zinc-300 font-medium">
                {sequentialExecution ? "🛡️ Peak Single-Model VRAM" : "⚡ Total Combined Model Footprint"}:
              </span>
              <span className={`font-bold px-1.5 py-0.5 rounded text-xs ${
                isMemoryOverflow 
                  ? 'bg-red-500/20 text-red-300 border border-red-500/40' 
                  : 'bg-zinc-800 text-white'
              }`}>
                ~{activeRequiredGB} GB
              </span>
              {!sequentialExecution && isMemoryOverflow && (
                <span className="text-red-400 font-bold text-[10px] animate-pulse">
                  (+{overflowDiffGB} GB OVER GPU CAPACITY)
                </span>
              )}
            </div>
            <div className="text-zinc-400 text-[10px]">
              GPU Ceiling: <span className="text-zinc-200 font-bold">{detectedGpuVRAMGB} GB</span> ({Math.min(999, Math.round((activeRequiredGB / detectedGpuVRAMGB) * 100))}%)
            </div>
          </div>

          {/* Progress Bar with Vivid Red styling on overflow */}
          <div className={`w-full rounded-full h-3 overflow-hidden border p-0.5 ${
            isMemoryOverflow 
              ? 'bg-red-950/60 border-red-500 shadow-[0_0_15px_rgba(239,68,68,0.3)]' 
              : 'bg-zinc-900 border-zinc-800'
          }`}>
            <div 
              className={`h-full rounded-full transition-all duration-300 ${
                isMemoryOverflow 
                  ? 'bg-gradient-to-r from-red-600 to-rose-500 shadow-[0_0_15px_rgba(239,68,68,0.9)] animate-pulse' 
                  : activeRequiredGB / detectedGpuVRAMGB > 0.8 
                    ? 'bg-gradient-to-r from-amber-500 to-orange-500' 
                    : 'bg-gradient-to-r from-emerald-500 to-teal-400'
              }`}
              style={{ width: `${Math.min(100, Math.round((activeRequiredGB / detectedGpuVRAMGB) * 100))}%` }}
            />
          </div>

          {/* Individual Targets Memory Breakdown Tags */}
          {targets.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
              <span className="text-[10px] font-mono text-zinc-500">Selected Models Breakdown:</span>
              {targets.map((t, idx) => {
                const mem = targetMemories[idx] || 0;
                const p = providers.find(prov => prov.id === t.provider_id);
                return (
                  <span key={idx} className="text-[10px] font-mono bg-black/50 border border-zinc-800 text-zinc-300 px-1.5 py-0.5 rounded">
                    #{idx+1} {p?.name?.split(' ')[1] || p?.type || 'Target'}: <strong className="text-white">~{mem} GB</strong>
                  </span>
                );
              })}
            </div>
          )}
        </div>

        {/* VRAM Overflow / Memory Collapse Warning Banner */}
        {isMemoryOverflow && (
          <div className="bg-red-950/60 border-2 border-red-500/80 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-red-200 shadow-[0_0_20px_rgba(239,68,68,0.25)] animate-in fade-in">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="h-5 w-5 text-red-400 shrink-0 mt-0.5 animate-bounce" />
              <div className="space-y-1">
                <span className="font-bold text-red-300 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                  🚨 CRITICAL: GPU VRAM LIMIT EXCEEDED (~{totalSimultaneousGB} GB &gt; {detectedGpuVRAMGB} GB)
                </span>
                <p className="text-[11px] text-red-200 leading-relaxed">
                  Running <strong>{targets.length} models simultaneously</strong> requires an estimated <strong>~{totalSimultaneousGB} GB VRAM</strong>, which exceeds your GPU space (<strong>{detectedGpuVRAMGB} GB</strong>) by <strong>+{overflowDiffGB} GB</strong>. 
                  Models may crash with CUDA Out-of-Memory (OOM), freeze the system, or suffer severe CPU offload paging. Switch to Sequential Execution to run them safely.
                </p>
              </div>
            </div>
            <button
              onClick={() => setSequentialExecution(true)}
              className="shrink-0 bg-red-600 hover:bg-red-500 text-white font-bold text-xs px-3.5 py-2 rounded-lg uppercase tracking-wider transition-all shadow-md hover:shadow-red-600/50 cursor-pointer flex items-center gap-1.5"
            >
              <ShieldCheck className="h-4 w-4" />
              Switch to Sequential Mode
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="py-16 text-center text-zinc-500 font-mono text-xs">
          Loading matrix configuration parameters...
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 flex-1 min-h-0">
          
          {/* LEFT COL (7/12): TARGET PAIRINGS */}
          <div className="md:col-span-7 space-y-2 flex flex-col min-h-0">
            <div className="flex justify-between items-center px-1">
              <h3 className="text-xs font-bold text-zinc-200 flex items-center gap-1.5 uppercase tracking-wider">
                <Server className="h-3.5 w-3.5 text-zinc-400" />
                1. Configured Execution Targets ({targets.length})
              </h3>
              <button 
                onClick={addTarget}
                className="flex items-center gap-1 text-[11px] font-semibold text-white bg-zinc-800 hover:bg-zinc-700 px-2.5 py-1 rounded-lg border border-zinc-700 transition-colors shadow-sm cursor-pointer"
              >
                <Plus className="h-3 w-3" /> Add Target
              </button>
            </div>

            <div className="space-y-2 overflow-y-auto flex-1 pr-1">
              {targets.length === 0 ? (
                <div className="p-6 border border-dashed border-zinc-800 rounded-xl text-center text-zinc-500 text-xs">
                  No targets added. Click "Add Target" to configure an engine/model pair.
                </div>
              ) : (
                targets.map((t, i) => {
                  const currentProv = providers.find(p => p.id === t.provider_id);
                  let provDiscovered: string[] = [];
                  if (currentProv && currentProv.last_models) {
                    try { provDiscovered = JSON.parse(currentProv.last_models); } catch(e) {}
                  }
                  // Merge discovered models + all catalog models
                  const availModels = Array.from(new Set([...provDiscovered, ...uniqueModelNames])).filter(Boolean);

                  const estMem = estimateMemoryGB(t.model_name, t.provider_id);

                  return (
                    <div key={i} className="bg-[#0e0e11] border border-zinc-800 rounded-xl p-3 space-y-2 shadow-sm">
                      <div className="flex justify-between items-center border-b border-zinc-800/60 pb-1.5">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-mono font-bold text-zinc-400 uppercase tracking-wider">
                            Target #{i+1}
                          </span>
                          <span className="text-[9px] bg-zinc-800 text-zinc-300 px-1.5 py-0.5 rounded font-mono border border-zinc-700">
                            Est. Model Weight: ~{estMem} GB VRAM
                          </span>
                        </div>
                        {targets.length > 1 && (
                          <button 
                            onClick={() => removeTarget(i)} 
                            className="text-zinc-500 hover:text-zinc-300 p-0.5 rounded transition-colors"
                            title="Remove target"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                      
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {/* Provider Select */}
                        <div className="space-y-1">
                          <label className="text-[10px] font-mono text-zinc-400 block">Serving Engine</label>
                          <select 
                            value={t.provider_id}
                            onChange={(e) => updateTarget(i, 'provider_id', parseInt(e.target.value))}
                            className="w-full bg-[#16161a] border border-zinc-700 hover:border-zinc-500 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-zinc-400 font-sans"
                          >
                            {providers.map(p => (
                              <option key={p.id} value={p.id} className="bg-zinc-900 text-white">
                                {p.name} ({p.type})
                              </option>
                            ))}
                          </select>
                        </div>

                        {/* Model Select */}
                        <div className="space-y-1">
                          <label className="text-[10px] font-mono text-zinc-400 block">Model Weight &amp; Name</label>
                          <select 
                            value={t.model_name}
                            onChange={(e) => updateTarget(i, 'model_name', e.target.value)}
                            className="w-full bg-[#16161a] border border-zinc-700 hover:border-zinc-500 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-zinc-400 font-mono"
                          >
                            {provDiscovered.length > 0 && (
                              <optgroup label="Discovered on this Engine">
                                {provDiscovered.map((m: string) => (
                                  <option key={`disc-${m}`} value={m} className="bg-zinc-900 text-emerald-300 font-medium">
                                    ★ {m} (Discovered)
                                  </option>
                                ))}
                              </optgroup>
                            )}

                            <optgroup label="Hugging Face / Open Models">
                              {uniqueModelNames.filter(m => (m.includes('/') || m.includes('instruct') || m.includes('Qwen') || m.includes('Llama') || m.includes('Mistral')) && !m.endsWith('.gguf') && !m.includes(':')).map((m: string) => (
                                <option key={`hf-${m}`} value={m} className="bg-zinc-900 text-blue-300">
                                  🤗 {m}
                                </option>
                              ))}
                            </optgroup>

                            <optgroup label="Ollama / llama.cpp GGUF Weights">
                              {uniqueModelNames.filter(m => m.endsWith('.gguf') || m.includes(':') || m.includes('0.5b') || m.includes('7b')).map((m: string) => (
                                <option key={`gguf-${m}`} value={m} className="bg-zinc-900 text-amber-300">
                                  📦 {m}
                                </option>
                              ))}
                            </optgroup>

                            <optgroup label="Cloud API Models (Closed Endpoints)">
                              {uniqueModelNames.filter(m => m.startsWith('gpt-') || m.startsWith('gemini-') || m.startsWith('deepseek-')).map((m: string) => (
                                <option key={`cloud-${m}`} value={m} className="bg-zinc-900 text-zinc-400">
                                  ☁️ {m} (Cloud API)
                                </option>
                              ))}
                            </optgroup>
                          </select>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* RIGHT COL (5/12): TASK SUITES */}
          <div className="md:col-span-5 space-y-2 flex flex-col min-h-0">
            <h3 className="text-xs font-bold text-zinc-200 flex items-center gap-1.5 uppercase tracking-wider px-1">
              <BookOpen className="h-3.5 w-3.5 text-zinc-400" />
              2. Select Task Suites ({selectedSuites.length} selected)
            </h3>
            
            <div className="space-y-1.5 overflow-y-auto flex-1 pr-1">
              {suites.length === 0 ? (
                <div className="p-6 border border-dashed border-zinc-800 rounded-xl text-center text-zinc-500 text-xs">
                  No task suites available.
                </div>
              ) : (
                suites.map(s => {
                  const isSelected = selectedSuites.includes(s.id);
                  return (
                    <div 
                      key={s.id}
                      onClick={() => setSelectedSuites(prev => isSelected ? prev.filter(id => id !== s.id) : [...prev, s.id])}
                      className={`p-2.5 rounded-xl border cursor-pointer transition-all flex items-center justify-between ${
                        isSelected 
                          ? 'bg-zinc-900 border-zinc-600 text-white shadow-sm' 
                          : 'bg-[#0c0c0e] border-zinc-800/80 text-zinc-400 hover:border-zinc-700 hover:text-zinc-300'
                      }`}
                    >
                      <div className="space-y-0.5">
                        <h4 className="text-xs font-semibold text-white">{s.name}</h4>
                        <p className="text-[10px] text-zinc-500 line-clamp-1">{s.description || 'Standard evaluation suite'}</p>
                      </div>
                      <div className={`w-4 h-4 rounded flex items-center justify-center border ${
                        isSelected ? 'bg-white border-white text-black' : 'border-zinc-700 bg-black/40'
                      }`}>
                        {isSelected && <CheckCircle2 className="h-3 w-3 stroke-[3]" />}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

        </div>
      )}

      {/* FOOTER ACTIONS */}
      <div className="pt-2 border-t border-zinc-800/80 flex justify-between items-center bg-[#0c0c0e] px-3 py-2 rounded-xl border border-zinc-800 flex-none">
        <div className="text-xs text-zinc-400 font-mono">
          Scenarios: <span className="font-bold text-white">{targets.length * selectedSuites.length} combinations</span> ({targets.length} targets * {selectedSuites.length} suites)
        </div>
        
        <button
          onClick={handleRun}
          disabled={isSubmitting || targets.length === 0 || selectedSuites.length === 0}
          className="flex items-center gap-2 px-5 py-2 rounded-lg font-bold text-xs bg-white text-black hover:bg-zinc-200 transition-all shadow-md disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
        >
          {isSubmitting ? (
            <div className="w-3.5 h-3.5 border-2 border-black/30 border-t-black rounded-full animate-spin" />
          ) : (
            <Zap className="h-3.5 w-3.5 fill-black" />
          )}
          RUN BENCHMARK MATRIX
        </button>
      </div>

    </div>
  );
}
