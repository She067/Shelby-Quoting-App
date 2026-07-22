import React, { useState } from "react";
import { supabase } from "../supabaseClient";
import { useNavigate } from "react-router-dom";

export default function LoginPage() {
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function login(e) {
    e.preventDefault();
    setBusy(true);
    setMsg("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setMsg(error.message);
    else nav("/customers");
    setBusy(false);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
      <div className="w-full max-w-md bg-white border rounded-lg p-6">
        <h1 className="text-xl font-semibold">Cabinet Quote Login</h1>
        <form onSubmit={login} className="mt-4 space-y-3">
          <input className="w-full border rounded px-3 py-2" placeholder="Email" value={email} onChange={(e)=>setEmail(e.target.value)} />
          <input className="w-full border rounded px-3 py-2" placeholder="Password" type="password" value={password} onChange={(e)=>setPassword(e.target.value)} />
          {msg && <div className="text-sm text-red-600">{msg}</div>}
          <button disabled={busy} className="w-full bg-black text-white rounded px-3 py-2 disabled:opacity-50">
            {busy ? "Logging in…" : "Login"}
          </button>
        </form>
      </div>
    </div>
  );
}
