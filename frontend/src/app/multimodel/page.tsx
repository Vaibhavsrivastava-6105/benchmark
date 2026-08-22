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
  ChevronRight
} from 'lucide-react';

export default function MultiModelMatrixPage() {
  const router = useRouter();
  
  const [providers, setProviders] = useState<any[]>([]);
  const [models, setModels] = useState<any[]>([]);
  const [suites, setSuites] = useState<any[]>([]);
  
  // Explicit targets: {provider_id, model_name}
  const [targets, setTargets] = useState<{provider_id: number, model_name: string}[]>([]);
  const [selectedSuites, setSelectedSuites] = useState<number[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch('/api/providers').then(r => r.json()),
      fetch('/api/models').then(r => r.json()),
      fetch('/api/prompts').then(r => r.json()),
    ]).then(([provData, modData, suiteData]) => {
      setProviders(provData || []);
      setModels(modData || []);
      
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

  const handleRun = async () => {
    if (targets.length === 0 || !selectedSuites.length) {
      alert('Please configure at least one target pairing and one task suite.');
      return;
    }
    
    setIsSubmitting(true);
    
    const uniqueProvIds = Array.from(new Set(targets.map(t => t.provider_id)));
    const uniqueModNames = Array.from(new Set(targets.map(t => t.model_name)));

    const payload = {
      name: `Explicit Pairings: ${targets.length} Targets`,
      provider_ids: uniqueProvIds,
      prompt_suite_ids: selectedSuites,
      model_names: uniqueModNames,
      targets: targets,
      benchmark_mode: 'standard',
      sequential_execution: true,
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
    const prov = providers[0];
    let firstModel = uniqueModelNames[0] || '';
    if (prov && prov.last_models) {
        try { 
            const arr = JSON.parse(prov.last_models); 
            if (arr.length > 0) firstModel = arr[0];
        } catch(e) {}
    }
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
    
    // Auto-select first model when provider changes
    if (field === 'provider_id') {
       const p = providers.find(prov => prov.id === value);
       let availModels: string[] = [];
       if (p && p.last_models) {
           try { availModels = JSON.parse(p.last_models); } catch(e) {}
       }
       if (availModels && availModels.length > 0) {
           newTargets[index].model_name = availModels[0];
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
                  let availModels: string[] = [];
                  if (currentProv && currentProv.last_models) {
                    try { availModels = JSON.parse(currentProv.last_models); } catch(e) {}
                  }
                  if (!availModels || availModels.length === 0) {
                    availModels = uniqueModelNames;
                  }

                  return (
                    <div key={i} className="bg-[#0e0e11] border border-zinc-800 rounded-xl p-3 space-y-2 shadow-sm">
                      <div className="flex justify-between items-center border-b border-zinc-800/60 pb-1.5">
                        <span className="text-[10px] font-mono font-bold text-zinc-400 uppercase tracking-wider">
                          Target #{i+1}
                        </span>
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
                          <label className="text-[10px] font-mono text-zinc-400 block">Model Weight</label>
                          <select 
                            value={t.model_name}
                            onChange={(e) => updateTarget(i, 'model_name', e.target.value)}
                            className="w-full bg-[#16161a] border border-zinc-700 hover:border-zinc-500 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-zinc-400 font-mono"
                          >
                            {availModels.map((m: string) => (
                              <option key={m} value={m} className="bg-zinc-900 text-white">
                                {m}
                              </option>
                            ))}
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
