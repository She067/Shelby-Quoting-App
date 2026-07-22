import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import LoginPage from "./pages/LoginPage";
import CustomersPage from "./pages/CustomersPage";
import CustomerDetailPage from "./pages/CustomerDetailPage";
import QuotePage from "./pages/QuotePage";
import RoomEditorPage from "./pages/RoomEditorPage";
import ProtectedRoute from "./auth/ProtectedRoute";
import ExtrasLibraryPage from "./pages/ExtrasLibraryPage";
import QuotePdfPage from "./pages/QuotePdfPage";
import PricingManagerPage from "./pages/PricingManagerPage";



export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route path="/customers" element={<ProtectedRoute><CustomersPage /></ProtectedRoute>} />
      <Route path="/customers/:id" element={<ProtectedRoute><CustomerDetailPage /></ProtectedRoute>} />
      <Route path="/extras" element={<ExtrasLibraryPage />} />
      <Route path="/quotes/:id" element={<ProtectedRoute><QuotePage /></ProtectedRoute>} />
      <Route path="/quotes/:quoteId/rooms/:roomId" element={<ProtectedRoute><RoomEditorPage /></ProtectedRoute>} />
      <Route
        path="/quotes/:id/pdf"
        element={
       <ProtectedRoute>
      <QuotePdfPage />
      </ProtectedRoute>
      }
      />
       <Route
       path="/pricing"
       element={
      <ProtectedRoute>
      <PricingManagerPage />
      </ProtectedRoute>
      }
      />

      <Route path="*" element={<Navigate to="/customers" replace />} />
    </Routes>
  );
}
