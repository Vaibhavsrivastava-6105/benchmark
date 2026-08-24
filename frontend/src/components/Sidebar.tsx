"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Play, List, Database, Cpu, Settings, Activity, Terminal, ScrollText, Layers } from "lucide-react";

export default function Sidebar() {
  const pathname = usePathname();

  const links = [
    { href: "/", label: "Dashboard", icon: LayoutDashboard },
    { href: "/benchmarks/new", label: "New Benchmark", icon: Play },
    { href: "/multimodel", label: "Multi-Model Matrix", icon: Layers },
    { href: "/compare", label: "Compare", icon: List },
    { href: "/models", label: "Models", icon: Database },
    { href: "/providers", label: "Providers", icon: Settings },
    { href: "/hardware", label: "Hardware", icon: Cpu },
    { href: "/requests", label: "Global Requests", icon: ScrollText },
    { href: "/datasets", label: "Datasets", icon: Database },
    { href: "/logs", label: "System Logs", icon: Terminal }
  ];

  return (
    <aside className="w-44 bg-[#0c0c0e] border-r border-zinc-800 flex flex-col shrink-0">
      {/* Brand Header */}
      <div className="px-3.5 py-3 border-b border-zinc-800/80 flex items-center justify-between">
        <h1 className="text-sm text-white font-bold tracking-tight flex items-center gap-1.5">
          <div className="p-1 bg-white text-black rounded-md">
            <Activity className="h-3.5 w-3.5 stroke-[2.5]" />
          </div>
          BenchLab
        </h1>
        <span className="text-[9px] font-mono px-1 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700">
          v1.0
        </span>
      </div>

      {/* Nav Links */}
      <nav className="flex-1 px-2 py-2 space-y-0.5 overflow-y-auto">
        {links.map(link => {
          const Icon = link.icon;
          const isActive = pathname === link.href;
          return (
            <Link 
              key={link.href}
              href={link.href} 
              className={`flex items-center gap-2 px-2.5 py-1.5 text-xs rounded-md transition-all ${
                isActive 
                  ? "bg-zinc-800 text-white font-semibold border border-zinc-700/60 shadow-sm" 
                  : "text-zinc-400 hover:text-white hover:bg-zinc-900/80"
              }`}
            >
              <Icon className={`h-3.5 w-3.5 shrink-0 ${isActive ? "text-white" : "text-zinc-400"}`} />
              <span className="truncate">{link.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="p-2.5 border-t border-zinc-800 text-[10px] text-zinc-500 font-mono flex items-center justify-between">
        <span>Engine Online</span>
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
      </div>
    </aside>
  );
}
