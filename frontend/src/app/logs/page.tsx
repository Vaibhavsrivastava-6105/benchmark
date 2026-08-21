"use client";

import React, { useState, useEffect } from "react";
import { Terminal, AlertTriangle, Info, AlertOctagon } from "lucide-react";

const API_BASE = "http://127.0.0.1:8001";

export default function LogsPage() {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_BASE}/api/logs`)
      .then(res => res.json())
      .then(data => {
        setLogs(data);
        setLoading(false);
      });
  }, []);

  return (
    <div className="p-8 w-full max-w-7xl mx-auto space-y-8 flex-1">
      <div>
        <h1 className="text-3xl font-bold text-white flex items-center gap-3">
          <Terminal className="h-8 w-8 text-cyan-500" />
          System Event Logs
        </h1>
        <p className="text-zinc-400 mt-2">Real-time system events, warnings, and provider connection logs.</p>
      </div>

      <div className="bg-[#0c0c0e] border border-zinc-800 rounded-xl overflow-hidden p-4">
        {loading ? (
          <div className="p-12 text-center text-zinc-500">Loading logs...</div>
        ) : (
          <div className="font-mono text-sm space-y-2 h-[70vh] overflow-y-auto">
            {logs.length === 0 && <div className="text-zinc-500 text-center py-12">No events recorded yet.</div>}
            {logs.map(log => (
              <div key={log.id} className="flex gap-4 border-b border-zinc-800/50 pb-2">
                <span className="text-zinc-500 whitespace-nowrap">
                  {new Date(log.timestamp / 1000).toLocaleString()}
                </span>
                <span className={`w-16 whitespace-nowrap font-bold ${
                  log.level === 'ERROR' ? 'text-red-500' :
                  log.level === 'WARNING' ? 'text-amber-500' : 'text-blue-500'
                }`}>
                  [{log.level}]
                </span>
                <span className="text-zinc-400 w-32 whitespace-nowrap">[{log.source}]</span>
                <span className={log.level === 'ERROR' ? 'text-red-400' : 'text-zinc-300'}>
                  {log.message}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
