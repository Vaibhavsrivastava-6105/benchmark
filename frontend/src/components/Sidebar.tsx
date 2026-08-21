"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Play, List, Database, Cpu, Settings, Activity } from "lucide-react";

export default function Sidebar() {
  const pathname = usePathname();

  const links = [
    { href: "/", label: "Dashboard", icon: LayoutDashboard },
    { href: "/benchmarks/new", label: "New Benchmark", icon: Play },
    { href: "/compare", label: "Compare", icon: List },
    { href: "/models", label: "Models", icon: Database },
    { href: "/providers", label: "Providers", icon: Settings },
    { href: "/hardware", label: "Hardware", icon: Cpu }
  ];

  return (
    <aside className="w-64 bg-[#0c0c0e] border-r border-zinc-800 flex flex-col">
      <div className="p-6">
        <h1 className="text-xl text-white font-bold tracking-tight flex items-center gap-2">
          <Activity className="h-5 w-5 text-cyan-500" />
          BenchLab
        </h1>
      </div>
      <nav className="flex-1 px-4 space-y-2">
        {links.map(link => {
          const Icon = link.icon;
          const isActive = pathname === link.href;
          return (
            <Link 
              key={link.href}
              href={link.href} 
              className={`flex items-center gap-3 px-3 py-2 text-sm rounded-lg transition-colors ${
                isActive 
                  ? "bg-zinc-800 text-white font-medium" 
                  : "text-zinc-400 hover:text-white hover:bg-zinc-900"
              }`}
            >
              <Icon className="h-4 w-4" /> {link.label}
            </Link>
          );
        })}
      </nav>
      <div className="p-4 border-t border-zinc-800 text-xs text-zinc-500">
        BenchLab v1.0
        <br/><span className="mt-1 block">Copyright 2024</span>
      </div>
    </aside>
  );
}
