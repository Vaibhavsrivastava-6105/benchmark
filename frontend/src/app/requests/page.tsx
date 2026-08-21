"use client";

import React, { useState, useEffect } from "react";
import { Activity, Clock, Server, Terminal, Search, Eye } from "lucide-react";
import Link from "next/link";

const API_BASE = "http://127.0.0.1:8001";

export default function RequestsPage() {
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedReq, setSelectedReq] = useState<any | null>(null);

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
    <div className="p-8 w-full max-w-7xl mx-auto space-y-8 flex-1">
      <div>
        <h1 className="text-3xl font-bold text-white flex items-center gap-3">
          <Terminal className="h-8 w-8 text-cyan-500" />
          Global Request History
        </h1>
        <p className="text-zinc-400 mt-2">Centralized log of all prompts sent across all providers.</p>
      </div>

      <div className="bg-[#0c0c0e] border border-zinc-800 rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-zinc-500">Loading requests...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-zinc-800 bg-black/40 text-xs uppercase font-bold tracking-wider text-zinc-500">
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
                    <td className="p-4 whitespace-nowrap text-xs text-zinc-500">
                      {new Date(req.created_at).toLocaleString()}
                    </td>
                    <td className="p-4">{req.provider_name}</td>
                    <td className="p-4 text-cyan-400">{req.model_name}</td>
                    <td className="p-4">
                      <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold border ${
                        req.status === 'SUCCESS' ? 'bg-emerald-950 border-emerald-800 text-emerald-400' :
                        req.status === 'FAILED' ? 'bg-red-950 border-red-800 text-red-400' :
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
                        className="text-cyan-500 hover:text-cyan-400 underline decoration-cyan-500/30 text-xs"
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
          <div className="bg-[#0c0c0e] border border-zinc-700 rounded-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto p-6 space-y-6 shadow-2xl">
            <div className="flex justify-between items-start border-b border-zinc-800 pb-4">
              <div>
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  Request #{selectedReq.id}
                  <span className={`px-2 py-0.5 rounded text-xs uppercase font-bold border ${
                    selectedReq.status === 'SUCCESS' ? 'bg-emerald-950 border-emerald-800 text-emerald-400' : 'bg-red-950 border-red-800 text-red-400'
                  }`}>
                    {selectedReq.status}
                  </span>
                </h2>
                <p className="text-zinc-400 text-sm mt-1">{selectedReq.provider_name} | {selectedReq.model_name}</p>
              </div>
              <button onClick={() => setSelectedReq(null)} className="text-zinc-500 hover:text-white">?</button>
            </div>
            
            <div className="space-y-4">
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
                  <pre className="bg-red-950/30 border border-red-900/50 p-4 rounded-lg text-xs text-red-400 font-mono whitespace-pre-wrap">
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
    </div>
  );
}
