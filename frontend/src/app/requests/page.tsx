"use client";

import React, { useState, useEffect } from "react";
import { Activity, Clock, Server, Terminal, Search, Eye, X } from "lucide-react";
import Link from "next/link";

const API_BASE = "";

export default function RequestsPage() {
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedReq, setSelectedReq] = useState<any | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [datasetName, setDatasetName] = useState(`Production Traffic Suite ${new Date().toISOString().slice(0, 10)}`);
  const [datasetCategory, setDatasetCategory] = useState("Production");

  const handleSelectAll = (e: any) => {
    if (e.target.checked) setSelectedIds(new Set(requests.map(r => r.id)));
    else setSelectedIds(new Set());
  };
  
  const handleSelect = (id: number) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };
  
  const handleExport = async () => {
    const res = await fetch(`${API_BASE}/api/requests/convert-to-dataset`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        request_ids: Array.from(selectedIds),
        dataset_name: datasetName,
        category: datasetCategory
      })
    });
    if (res.ok) {
       alert("Successfully converted traffic to dataset!");
       setExportModalOpen(false);
       setSelectedIds(new Set());
    } else {
       const errData = await res.json().catch(()=>({}));
       alert(`Failed to export dataset: ${errData.detail || "Server error"}`);
    }
  };

  useEffect(() => {
    fetch(`${API_BASE}/api/requests?limit=200`)
      .then(res => res.json())
      .then(data => {
        setRequests(data);
        setLoading(false);
      });
  }, []);

  const openDetails = async (id: number) => {
    const res = await fetch(`${API_BASE}/api/requests/${id}`);
    const data = await res.json();
    setSelectedReq(data);
  };

  return (
    <div className="p-2 space-y-2 flex-1 h-full flex flex-col overflow-hidden">
            <div className="flex justify-between items-end">
        <div>
          <h1 className="text-sm font-bold text-white flex items-center gap-3">
            <Terminal className="h-8 w-8 text-white" />
            Global Request History
          </h1>
          <p className="text-zinc-400 mt-2">Centralized log of all prompts sent across all providers.</p>
        </div>
        {selectedIds.size > 0 && (
          <button 
            onClick={() => setExportModalOpen(true)}
            className="px-4 py-2 bg-white text-black font-bold font-mono text-sm rounded hover:bg-zinc-200 transition"
          >
            Export to Test Dataset ({selectedIds.size})
          </button>
        )}
      </div>

      <div className="bg-[#0c0c0e] border border-zinc-800 rounded-xl overflow-hidden flex-1 flex flex-col">
        {loading ? (
          <div className="p-12 text-center text-zinc-500">Loading requests...</div>
        ) : (
          <div className="overflow-auto flex-1">
            <table className="w-full text-left border-collapse">
              <thead>
                                <tr className="border-b border-zinc-800 bg-black/40 text-xs uppercase font-bold tracking-wider text-zinc-500">
                  <th className="p-4 w-10">
                    <input 
                      type="checkbox" 
                      onChange={handleSelectAll} 
                      checked={requests.length > 0 && selectedIds.size === requests.length}
                      className="accent-white w-4 h-4 cursor-pointer"
                    />
                  </th>
                  <th className="p-4">Time</th>
                  <th className="p-4">Provider</th>
                  <th className="p-4">Model</th>
                  <th className="p-4">Status</th>
                  <th className="p-4">Latency</th>
                  <th className="p-4">Tokens (In/Out)</th>
                  <th className="p-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="text-sm font-mono text-zinc-300">
                {requests.map(req => (
                                    <tr key={req.id} className="border-b border-zinc-800/50 hover:bg-zinc-900/30 transition-colors">
                    <td className="p-4 w-10">
                      <input 
                        type="checkbox" 
                        checked={selectedIds.has(req.id)}
                        onChange={() => handleSelect(req.id)}
                        className="accent-white w-4 h-4 cursor-pointer"
                      />
                    </td>
                    <td className="p-4 whitespace-nowrap text-xs text-zinc-500">
                      {new Date(req.created_at).toLocaleString()}
                    </td>
                    <td className="p-4">{req.provider_name}</td>
                    <td className="p-4 text-white">{req.model_name}</td>
                    <td className="p-4">
                      <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold border ${
                        req.status === 'SUCCESS' ? 'bg-zinc-900 border-zinc-500 text-zinc-100' :
                        req.status === 'FAILED' ? 'bg-zinc-800 border-zinc-700 text-zinc-500' :
                        'bg-zinc-900 border-zinc-700 text-zinc-400'
                      }`}>
                        {req.status}
                      </span>
                    </td>
                    <td className="p-4">{req.latency_ms ? req.latency_ms.toFixed(0) + ' ms' : '-'}</td>
                    <td className="p-4">{req.prompt_tokens} / {req.output_tokens}</td>
                    <td className="p-4 text-right">
                      <button 
                        onClick={() => openDetails(req.id)}
                        className="text-white hover:text-white underline decoration-cyan-500/30 text-xs"
                      >
                        Inspect
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selectedReq && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0c0c0e] border border-zinc-700 rounded-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto p-2 space-y-2 shadow-2xl">
            <div className="flex justify-between items-start border-b border-zinc-800 pb-4">
              <div>
                <h2 className="text-sm font-bold text-white flex items-center gap-2">
                  Request #{selectedReq.id}
                  <span className={`px-2 py-0.5 rounded text-xs uppercase font-bold border ${
                    selectedReq.status === 'SUCCESS' ? 'bg-zinc-900 border-zinc-500 text-zinc-100' : 'bg-zinc-800 border-zinc-700 text-zinc-500'
                  }`}>
                    {selectedReq.status}
                  </span>
                </h2>
                <p className="text-zinc-400 text-sm mt-1">{selectedReq.provider_name} | {selectedReq.model_name}</p>
              </div>
              <button onClick={() => setSelectedReq(null)} className="text-zinc-500 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>
            
            <div className="space-y-1">
              <div>
                <h3 className="text-xs uppercase font-bold text-zinc-500 mb-2 tracking-widest">System Prompt</h3>
                <pre className="bg-black border border-zinc-800 p-4 rounded-lg text-xs text-zinc-300 font-mono whitespace-pre-wrap">
                  {selectedReq.system_prompt || "None"}
                </pre>
              </div>
              <div>
                <h3 className="text-xs uppercase font-bold text-zinc-500 mb-2 tracking-widest">User Prompt</h3>
                <pre className="bg-black border border-zinc-800 p-4 rounded-lg text-xs text-zinc-300 font-mono whitespace-pre-wrap">
                  {selectedReq.prompt_text}
                </pre>
              </div>
              <div>
                <h3 className="text-xs uppercase font-bold text-zinc-500 mb-2 tracking-widest">Response Text</h3>
                {selectedReq.error_message ? (
                  <pre className="bg-zinc-800 border border-zinc-700 p-4 rounded-lg text-xs text-zinc-500 font-mono whitespace-pre-wrap">
                    {selectedReq.error_message}
                  </pre>
                ) : (
                  <pre className="bg-black border border-zinc-800 p-4 rounded-lg text-xs text-zinc-300 font-mono whitespace-pre-wrap">
                    {selectedReq.response_text}
                  </pre>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      {exportModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0c0c0e] border border-zinc-700 rounded-xl w-full max-w-md p-6 shadow-2xl">
            <h2 className="text-xl font-bold text-white mb-2 font-mono">Convert to Test Dataset</h2>
            <p className="text-zinc-400 text-sm mb-6">Create an evaluation benchmark suite from {selectedIds.size} production requests.</p>
            
            <div className="space-y-4 font-mono text-sm">
              <div>
                <label className="block text-zinc-500 mb-1">Dataset Name</label>
                <input 
                  type="text" 
                  value={datasetName}
                  onChange={(e) => setDatasetName(e.target.value)}
                  className="w-full bg-black border border-zinc-800 text-white rounded px-3 py-2 focus:border-zinc-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-zinc-500 mb-1">Category</label>
                <input 
                  type="text" 
                  value={datasetCategory}
                  onChange={(e) => setDatasetCategory(e.target.value)}
                  className="w-full bg-black border border-zinc-800 text-white rounded px-3 py-2 focus:border-zinc-500 outline-none"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-8">
              <button 
                onClick={() => setExportModalOpen(false)}
                className="px-4 py-2 bg-transparent text-zinc-400 hover:text-white font-mono"
              >
                Cancel
              </button>
              <button 
                onClick={handleExport}
                className="px-4 py-2 bg-white text-black font-bold font-mono rounded hover:bg-zinc-200"
              >
                Create Dataset
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
