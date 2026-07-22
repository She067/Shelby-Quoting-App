console.log("UI LOADED ✅", new Date().toISOString());
import React from "react";

export function Page({ title, subtitle, actions, children }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="sticky top-0 z-[9999] border-b bg-white/80 backdrop-blur pointer-events-auto">
        <div className="h-1 w-full bg-blue-600" />
        <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-blue-600 text-white flex items-center justify-center font-bold">
              CQ
            </div>
            <div>
              <div className="font-semibold leading-tight text-slate-900">{title}</div>
              {subtitle ? (
                <div className="text-sm text-slate-500 leading-tight">{subtitle}</div>
              ) : null}
            </div>
          </div>

          {/* ✅ Actions container */}
          <div className="flex items-center gap-2 relative z-[9999] pointer-events-auto">
            {actions}
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-4 py-5">{children}</div>
    </div>
  );
}



export function Card({ children, className = "" }) {
  return (
    <div className={`rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-200/50 ${className}`}>
      {children}
    </div>
  );
}

export function CardHeader({ title, right, className = "" }) {
  return (
    <div className={`px-4 py-3 border-b border-slate-200 flex items-center justify-between ${className}`}>
      <div className="font-semibold text-slate-900">{title}</div>
      {right ? <div>{right}</div> : null}
    </div>
  );
}

export function CardBody({ children, className = "" }) {
  return <div className={`p-4 ${className}`}>{children}</div>;
}

export function Button({ variant = "primary", className = "", ...props }) {
  const base =
    "inline-flex items-center justify-center rounded-xl px-3 py-2 text-sm font-medium transition active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed";

  const styles =
    variant === "primary"
      ? "bg-blue-600 text-white hover:bg-blue-700"
      : variant === "secondary"
      ? "bg-white border border-slate-200 text-slate-800 hover:bg-slate-50"
      : variant === "ghost"
      ? "text-slate-700 hover:bg-slate-100"
      : "bg-white border";

  return <button className={`${base} ${styles} ${className}`} {...props} />;
}

export function Pill({ tone = "amber", children }) {
  const cls =
    tone === "green"
      ? "bg-green-100 text-green-800 border border-green-200"
      : tone === "amber"
      ? "bg-amber-100 text-amber-800 border border-amber-200"
      : "bg-slate-100 text-slate-800 border border-slate-200";
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${cls}`}>{children}</span>;
}

export function Input({ className = "", ...props }) {
  return (
    <input
      className={
        "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm " +
        "placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-200 " +
        className
      }
      {...props}
    />
  );
}

export function Select({ className = "", children, ...props }) {
  return (
    <select
      className={
        "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm " +
        "focus:outline-none focus:ring-2 focus:ring-blue-200 " +
        className
      }
      {...props}
    >
      {children}
    </select>
  );
}
