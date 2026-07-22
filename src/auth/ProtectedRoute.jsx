import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./AuthProvider";

export default function ProtectedRoute({ children }) {
  const { user, session, loading } = useAuth();
  const location = useLocation();

  if (loading) return <div className="p-6">Loading…</div>;

  // ✅ session OR user prevents false redirects
  if (!user && !session) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return children;
}
