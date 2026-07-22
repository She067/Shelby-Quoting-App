import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";
import { Link, useNavigate } from "react-router-dom";
import { Page, Card, CardHeader, CardBody, Button, Input, Select } from "../components/ui";

export default function CustomersPage() {
  const nav = useNavigate();
  const [customerTypes, setCustomerTypes] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);

  const [q, setQ] = useState("");
  const [filterTypeId, setFilterTypeId] = useState("all");

  const [showAdd, setShowAdd] = useState(false);
  const [newTypeId, setNewTypeId] = useState("");
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPhone, setNewPhone] = useState("");

  const [deleteBusyId, setDeleteBusyId] = useState(null);

  async function load() {
    setLoading(true);

    const { data: types, error: typeErr } = await supabase
      .from("customer_types")
      .select("id,name,sort_order,is_active")
      .eq("is_active", true)
      .order("sort_order", { ascending: true });

    if (typeErr) console.error(typeErr);
    setCustomerTypes(types ?? []);
    setNewTypeId((types ?? [])[0]?.id ?? "");

    const { data: cust, error: custErr } = await supabase
      .from("customers")
      .select("id,name,email,phone,default_customer_type_id,created_at,is_active")
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    if (custErr) console.error(custErr);
    setCustomers(cust ?? []);

    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return customers.filter((c) => {
      const matchesSearch =
        !needle ||
        c.name?.toLowerCase().includes(needle) ||
        c.email?.toLowerCase().includes(needle) ||
        c.phone?.toLowerCase().includes(needle);

      const matchesType = filterTypeId === "all" || c.default_customer_type_id === filterTypeId;
      return matchesSearch && matchesType;
    });
  }, [customers, q, filterTypeId]);

  async function addCustomer() {
    if (!newName.trim()) return alert("Name is required.");
    if (!newTypeId) return alert("Customer Type is required.");

    const { error } = await supabase.from("customers").insert({
      name: newName.trim(),
      email: newEmail.trim() || null,
      phone: newPhone.trim() || null,
      default_customer_type_id: newTypeId,
      is_active: true,
    });

    if (error) return alert(error.message);

    setShowAdd(false);
    setNewName("");
    setNewEmail("");
    setNewPhone("");
    await load();
  }

  async function deleteCustomer(customerId, customerName) {
    const ok = window.confirm(
      `Delete customer "${customerName}"?\n\nThis will hide the customer and also hide all quotes for them.\n(Quote numbers will NOT change.)`
    );
    if (!ok) return;

    setDeleteBusyId(customerId);
    try {
      // 1) Soft-delete all quotes for this customer (recommended)
      // If your quotes table doesn't have is_active yet, add it first (see SQL in my message).
      const { error: qErr } = await supabase
        .from("quotes")
        .update({ is_active: false, deleted_at: new Date().toISOString() })
        .eq("customer_id", customerId);

      // If you haven't added deleted_at, you can remove it from the update.
      if (qErr && qErr.message) {
        // If this fails because deleted_at doesn't exist, you'll see it here.
        console.warn("Quote soft-delete warning:", qErr.message);
        // We still continue to hide customer.
      }

      // 2) Soft-delete customer
      const { error: cErr } = await supabase
        .from("customers")
        .update({ is_active: false })
        .eq("id", customerId);

      if (cErr) throw cErr;

      await load();
    } catch (e) {
      console.error(e);
      alert(e.message || "Failed to delete customer.");
    } finally {
      setDeleteBusyId(null);
    }
  }

  if (loading) return <div className="p-6">Loading…</div>;

  return (
    <Page
      title="Customers"
      subtitle="Add a customer, then create quotes under them."
      actions={
        <>
          <Button variant="secondary" onClick={() => nav("/pricing")}>
            Pricing
          </Button>

          <Button
            variant="secondary"
            onClick={async () => {
              await supabase.auth.signOut();
              nav("/login");
            }}
          >
            Logout
          </Button>

          <Button onClick={() => setShowAdd(true)}>+ Add Customer</Button>
        </>
      }
    >
      <Card className="mb-4">
        <CardBody>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="md:col-span-2">
              <label className="text-sm text-slate-600">Search</label>
              <Input
                className="mt-1"
                placeholder="Search name/email/phone…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm text-slate-600">Customer Type</label>
              <Select className="mt-1" value={filterTypeId} onChange={(e) => setFilterTypeId(e.target.value)}>
                <option value="all">All Types</option>
                {customerTypes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Customer List" />
        <CardBody className="p-0">
          {filtered.length === 0 ? (
            <div className="p-4 text-slate-600">No customers found.</div>
          ) : (
            <ul className="divide-y">
              {filtered.map((c) => (
                <li key={c.id} className="px-4 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{c.name}</div>
                    <div className="text-sm text-slate-500">
                      {c.email ? c.email : ""}
                      {c.email && c.phone ? " • " : ""}
                      {c.phone ? c.phone : ""}
                    </div>
                  </div>

                  <div className="flex items-center shrink-0">
  {/* Primary Action */}
  <Link
    className="text-sm font-medium text-blue-700 hover:underline mr-6"
    to={`/customers/${c.id}`}
  >
    Open →
  </Link>

  {/* Subtle Danger Action */}
  <button
    type="button"
    disabled={deleteBusyId === c.id}
    onClick={() => deleteCustomer(c.id, c.name)}
    className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50"
  >
    {deleteBusyId === c.id ? "..." : "Delete"}
  </button>
</div>

                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {showAdd && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-lg">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
              <div className="font-semibold">Add Customer</div>
              <button className="text-slate-500 hover:text-slate-900" onClick={() => setShowAdd(false)}>
                ✕
              </button>
            </div>

            <div className="p-4 space-y-3">
              <div>
                <label className="text-sm text-slate-600">Customer Type</label>
                <Select className="mt-1" value={newTypeId} onChange={(e) => setNewTypeId(e.target.value)}>
                  {customerTypes.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              </div>

              <div>
                <label className="text-sm text-slate-600">Name</label>
                <Input className="mt-1" value={newName} onChange={(e) => setNewName(e.target.value)} />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-sm text-slate-600">Email</label>
                  <Input className="mt-1" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
                </div>
                <div>
                  <label className="text-sm text-slate-600">Phone</label>
                  <Input className="mt-1" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="secondary" onClick={() => setShowAdd(false)}>
                  Cancel
                </Button>
                <Button onClick={addCustomer}>Save</Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </Page>
  );
}
