"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Drafts" },
  { href: "/runs", label: "Pipeline runs" },
  { href: "/thesis", label: "Thesis" },
  { href: "/sources", label: "Sources" },
  { href: "/how-it-works", label: "How it works" },
];

export function Nav() {
  const path = usePathname();
  if (path === "/login") return null;
  return (
    <header className="sticky top-0 z-10 border-b border-stone-200 bg-white/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-6 overflow-x-auto px-4 py-3 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2 font-semibold tracking-tight">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-stone-900 text-sm text-white">⚡</span>
          <span className="hidden sm:inline">Funding Outreach Engine</span>
        </Link>
        <nav className="flex gap-1">
          {LINKS.map((l) => {
            const active = l.href === "/" ? path === "/" : path.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm transition-colors ${
                  active ? "bg-stone-900 text-white" : "text-stone-600 hover:bg-stone-100 hover:text-stone-900"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
