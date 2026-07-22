import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Page, Card, CardHeader, CardBody, Button, Input } from "../components/ui";

export default function CustomerDetailPage() {
  const nav = useNavigate();
  const { id: customerId } = useParams();

  const [loading, setLoading] = useState(true);
  const [customer, setCustomer] = useState(null);
  const [quotes, setQuotes] = useState([]);

  const [q, setQ] = useState("");
  const [deleteQuoteBusyId, setDeleteQuoteBusyId] = useState(null);

  // Add Quote UI
  const [showAddQuote, setShowAddQuote] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newSiteAddress, setNewSiteAddress] = useState("");
  const [createBusy, setCreateBusy] = useState(false);

  async function load() {
    setLoading(true);

    const { data: c, error: cErr } = await supabase
      .from("customers")
      .select("id,name,email,phone,is_active,created_at")
      .eq("id", customerId)
      .single();

    if (cErr) {
      console.error(cErr);
      alert(cErr.message);
      setLoading(false);
      return;
    }
    setCustomer(c);

    const { data: qs, error: qErr } = await supabase
      .from("quotes")
      .select("id,quote_number,project_name,site_address,status,created_at,is_active")
      .eq("customer_id", customerId)
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    if (qErr) console.error(qErr);
    setQuotes(qs ?? []);

    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);

  const filteredQuotes = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return quotes;
    return (quotes ?? []).filter((x) => {
      return (
        (x.quote_number ?? "").toString().toLowerCase().includes(needle) ||
        (x.project_name ?? "").toLowerCase().includes(needle) ||
        (x.site_address ?? "").toLowerCase().includes(needle) ||
        (x.status ?? "").toLowerCase().includes(needle)
      );
    });
  }, [quotes, q]);

  async function createQuote() {
    const project_name = newProjectName.trim();
    const site_address = newSiteAddress.trim();

    if (!project_name) return alert("Project name is required.");
    if (!site_address) return alert("Site address is required.");

    setCreateBusy(true);
    try {
      const payload = {
        customer_id: customerId,
        project_name,
        site_address,
        status: "draft",
        is_active: true,
      };

      // 1st attempt
      let { data, error } = await supabase
        .from("quotes")
        .insert(payload)
        .select("id")
        .single();

      // One retry if unique quote_number collided (should stop after DB fix)
      if (error && error.code === "23505") {
        console.warn("createQuote collision, retrying once...", error.message);
        const retry = await supabase.from("quotes").insert(payload).select("id").single();
        data = retry.data;
        error = retry.error;
      }

      if (error) throw error;

      // reset UI + go to quote
      setShowAddQuote(false);
      setNewProjectName("");
      setNewSiteAddress("");

      await load();
      nav(`/quotes/${data.id}`);
    } catch (e) {
      console.error(e);
      alert(e.message || "Failed to create quote.");
    } finally {
      setCreateBusy(false);
    }
  }

  async function deleteQuote(quoteId, quoteNumber) {
    const ok = window.confirm(
      `Delete Quote ${quoteNumber}?\n\nThis will hide the quote (soft delete).\nQuote numbers will NOT change.`
    );
    if (!ok) return;

    setDeleteQuoteBusyId(quoteId);
    try {
      const { error } = await supabase
        .from("quotes")
        .update({ is_active: false, deleted_at: new Date().toISOString() })
        .eq("id", quoteId);

      if (error) throw error;

      await load();
    } catch (e) {
      console.error(e);
      alert(e.message || "Failed to delete quote.");
    } finally {
      setDeleteQuoteBusyId(null);
    }
  }

  if (loading) return <div className="p-6">Loading…</div>;

  return (
    <Page
      title={customer ? customer.name : "Customer"}
      subtitle="Quotes for this customer"
      actions={
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => nav("/customers")}>
            ← Back
          </Button>

          <Button onClick={() => setShowAddQuote((v) => !v)}>
            {showAddQuote ? "Close" : "+ Add Quote"}
          </Button>
        </div>
      }
    >
      {showAddQuote && (
        <Card className="mb-4">
          <CardHeader title="New Quote" />
          <CardBody>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <div className="text-xs text-slate-500">Project Name</div>
                <Input
                  className="mt-1"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  placeholder="Smith Kitchen / Personal House / etc."
                />
              </div>

              <div>
                <div className="text-xs text-slate-500">Site Address</div>
                <Input
                  className="mt-1"
                  value={newSiteAddress}
                  onChange={(e) => setNewSiteAddress(e.target.value)}
                  placeholder="123 Main St, City, ST"
                />
              </div>
            </div>

            <div className="mt-4 flex items-center gap-2">
              <Button disabled={createBusy} onClick={createQuote}>
                {createBusy ? "Creating..." : "Create Quote"}
              </Button>
              <Button
                variant="secondary"
                disabled={createBusy}
                onClick={() => {
                  setShowAddQuote(false);
                  setNewProjectName("");
                  setNewSiteAddress("");
                }}
              >
                Cancel
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      <Card className="mb-4">
        <CardBody>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <div className="text-xs text-slate-500">Email</div>
              <div className="text-sm">{customer?.email || "—"}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Phone</div>
              <div className="text-sm">{customer?.phone || "—"}</div>
            </div>
            <div>
              <label className="text-sm text-slate-600">Search Quotes</label>
              <Input
                className="mt-1"
                placeholder="Search quote # / project / address…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Quotes" />
        <CardBody className="p-0">
          {filteredQuotes.length === 0 ? (
            <div className="p-4 text-slate-600">No quotes found.</div>
          ) : (
            <ul className="divide-y">
              {filteredQuotes.map((qt) => (
                <li key={qt.id} className="px-4 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium truncate">
                      Quote {qt.quote_number ?? "—"} {qt.project_name ? `• ${qt.project_name}` : ""}
                    </div>
                    <div className="text-sm text-slate-500 truncate">
                      {qt.site_address || ""}
                      {qt.status ? ` • ${qt.status}` : ""}
                    </div>
                  </div>

                  <div className="flex items-center shrink-0">
                    <Link className="text-sm font-medium text-blue-700 hover:underline mr-6" to={`/quotes/${qt.id}`}>
                      Open →
                    </Link>

                    <button
                      type="button"
                      disabled={deleteQuoteBusyId === qt.id}
                      onClick={() => deleteQuote(qt.id, qt.quote_number)}
                      className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50"
                    >
                      {deleteQuoteBusyId === qt.id ? "..." : "Delete"}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </Page>
  );
}