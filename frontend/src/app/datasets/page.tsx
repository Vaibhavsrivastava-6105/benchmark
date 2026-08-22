"use client";
import React, { useState, useEffect } from "react";
import { Database, Download, Upload, Plus, Search, Trash2 } from "lucide-react";

interface PromptSuite {
  id: number;
  name: string;
  description: string;
  created_at: string;
}

export default function DatasetsPage() {
  const [suites, setSuites] = useState<PromptSuite[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const fetchSuites = () => {
    fetch("/api/prompts")
      .then(res => res.json())
      .then(data => {
        setSuites(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    fetchSuites();
  }, []);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const defaultName = file.name.replace(".csv", "");
    const name = prompt("Enter a name for this dataset:", defaultName) || defaultName;
    
    const formData = new FormData();
    formData.append("file", file);
    formData.append("name", name);
    formData.append("description", "Uploaded via CSV");

    setUploading(true);
    try {
      const res = await fetch("/api/prompts/upload", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json();
        alert(`Upload failed: ${err.detail}`);
      } else {
        const newSuite = await res.json();
        setSuites(prev => [...prev, newSuite]);
      }
    } catch (err) {
      alert("Failed to upload dataset.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const deleteSuite = async (suite: PromptSuite) => {
    if (!confirm(`Are you sure you want to delete dataset "${suite.name}"?`)) return;
    try {
      const res = await fetch(`/api/prompts/${suite.id}`, { method: "DELETE" });
      if (res.ok) {
        setSuites(prev => prev.filter(s => s.id !== suite.id));
      } else {
        alert("Failed to delete dataset.");
      }
    } catch (e) {
      alert("Error deleting dataset.");
    }
  };

  const downloadSuite = (suite: PromptSuite) => {
    window.open(`/api/prompts/${suite.id}/export?format=json`, '_blank');
  };

  const filteredSuites = suites.filter(s => 
    s.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
    (s.description && s.description.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white flex items-center gap-3">
            <Database className="w-8 h-8 text-blue-500" />
            Evaluation Datasets
          </h1>
          <p className="text-zinc-400 mt-2">Manage, version, and export your Prompt Suites.</p>
        </div>
        
        <div className="flex items-center gap-3">
          <input type="file" accept=".csv" hidden ref={fileInputRef} onChange={handleFileUpload} />
          <button 
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg flex items-center gap-2 text-sm font-medium transition-colors border border-zinc-700 disabled:opacity-50"
          >
            <Upload className="w-4 h-4" />
            {uploading ? "Uploading..." : "Upload CSV"}
          </button>
        </div>
        
        
      </div>

      <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl overflow-hidden backdrop-blur-xl">
        <div className="p-4 border-b border-zinc-800 bg-zinc-900/80 flex items-center gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
            <input 
              type="text" 
              placeholder="Search datasets..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg pl-10 pr-4 py-2 text-sm text-white focus:outline-none focus:border-zinc-700 focus:ring-1 focus:ring-zinc-700 transition-all"
            />
          </div>
        </div>

        {loading ? (
          <div className="p-8 text-center text-zinc-500 text-sm">Loading datasets...</div>
        ) : filteredSuites.length === 0 ? (
          <div className="p-12 text-center flex flex-col items-center">
            <Database className="w-12 h-12 text-zinc-700 mb-4" />
            <h3 className="text-lg font-medium text-white mb-2">No datasets found</h3>
            <p className="text-zinc-500 text-sm max-w-sm">Upload a CSV or create a dataset from your production traffic to get started.</p>
          </div>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-zinc-800/80 bg-zinc-950/50">
                <th className="px-6 py-4 text-xs font-semibold text-zinc-400 uppercase tracking-wider">Dataset Name</th>
                <th className="px-6 py-4 text-xs font-semibold text-zinc-400 uppercase tracking-wider">Description</th>
                <th className="px-6 py-4 text-xs font-semibold text-zinc-400 uppercase tracking-wider">Created</th>
                <th className="px-6 py-4 text-xs font-semibold text-zinc-400 uppercase tracking-wider text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/50">
              {filteredSuites.map((suite) => (
                <tr key={suite.id} className="hover:bg-zinc-800/20 transition-colors group">
                  <td className="px-6 py-4">
                    <div className="font-medium text-zinc-200">{suite.name}</div>
                    <div className="text-xs text-zinc-500 mt-1">ID: {suite.id}</div>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-sm text-zinc-400">{suite.description || "No description provided."}</span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="text-sm text-zinc-500">{new Date(suite.created_at).toLocaleDateString()}</span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => downloadSuite(suite)} className="p-2 hover:bg-zinc-700 rounded-lg text-zinc-400 hover:text-white transition-colors" title="Download JSON/CSV">
                        <Download className="w-4 h-4" />
                      </button>
                      <button onClick={() => deleteSuite(suite)} className="p-2 hover:bg-red-500/20 rounded-lg text-zinc-400 hover:text-red-400 transition-colors" title="Delete Dataset">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
