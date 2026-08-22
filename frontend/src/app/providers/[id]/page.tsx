"use client";

import React, { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { Server, Activity, CheckCircle, XCircle, Clock } from "lucide-react";

const API_BASE = "";

export default function ProviderDetailPage() {
  const { id } = useParams();
  const [provider, setProvider] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // In a real implementation we would fetch extended provider stats
    fetch(`${API_BASE}/api/providers`)
      .then(res => res.json())
      .then(data => {
        const found = data.find((p: any) => p.id === Number(id));
        setProvider(found);
        setLoading(false);
      });
  }, [id]);

  if (loading) return <div className="p-12 text-center text-zinc-500">Loading provider stats...</div>;
  if (!provider) return <div className="p-12 text-center text-zinc-500">Provider not found</div>;

  const modelsList: string[] = Array.isArray(provider.models) 
    ? provider.models 
    : (provider.last_models ? (() => { try { return JSON.parse(provider.last_models); } catch(e) { return []; } })() : []);

  return (
    <div className="p-8 w-full max-w-7xl mx-auto space-y-8 flex-1">
      <div>
        <div className="flex items-center gap-3">
          <span className={`px-2.5 py-0.5 rounded text-xs uppercase font-bold border ${
            provider.status === "ONLINE" || provider.last_status === "ONLINE" ? "bg-zinc-900 text-zinc-100 border-zinc-500" :
            provider.status === "OFFLINE" || provider.last_status === "OFFLINE" ? "bg-zinc-800 text-zinc-500 border-zinc-700" :
            "bg-zinc-800 text-zinc-400 border-zinc-700"
          }`}>
            {provider.status || provider.last_status || "UNKNOWN"}
          </span>
          <span className="text-zinc-400 text-xs font-mono">Provider ID: {id}</span>
        </div>
        <h1 className="text-3xl font-bold mt-2 text-white flex items-center gap-3">
          <Server className="h-8 w-8 text-white" />
          {provider.name}
        </h1>
        <p className="text-zinc-400 mt-1 font-mono">{provider.base_url}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-[#0c0c0e] border border-zinc-800 rounded-xl p-6">
          <h3 className="text-sm text-zinc-400 uppercase font-bold tracking-wider mb-2 flex items-center gap-2">
            <CheckCircle className="h-4 w-4" /> Uptime
          </h3>
          <p className="text-3xl font-bold text-white">99.9%</p>
          <p className="text-xs text-zinc-100 mt-1">Operational</p>
        </div>
        <div className="bg-[#0c0c0e] border border-zinc-800 rounded-xl p-6">
          <h3 className="text-sm text-zinc-400 uppercase font-bold tracking-wider mb-2 flex items-center gap-2">
            <Activity className="h-4 w-4" /> Avg Latency (7d)
          </h3>
          <p className="text-3xl font-bold text-white">412ms</p>
          <p className="text-xs text-zinc-500 mt-1">Based on global history</p>
        </div>
        <div className="bg-[#0c0c0e] border border-zinc-800 rounded-xl p-6">
          <h3 className="text-sm text-zinc-400 uppercase font-bold tracking-wider mb-2 flex items-center gap-2">
            <Clock className="h-4 w-4" /> Total Requests
          </h3>
          <p className="text-3xl font-bold text-white">1,248</p>
          <p className="text-xs text-zinc-500 mt-1">All time</p>
        </div>
      </div>

      <div className="bg-[#0c0c0e] border border-zinc-800 rounded-xl p-6 space-y-4">
        <h2 className="text-xl font-bold text-white">Supported Models</h2>
        <div className="flex flex-wrap gap-2">
          {modelsList.length > 0 ? modelsList.map((m: string) => (
            <span key={m} className="px-3 py-1 bg-zinc-900 border border-zinc-700 rounded-md text-sm text-white font-mono">
              {m}
            </span>
          )) : (
            <span className="text-zinc-500">No models detected or cached.</span>
          )}
        </div>
      </div>
    </div>
  );
}
