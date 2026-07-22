import React, { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { Page, Card, CardHeader, CardBody, Button, Input, Select } from "../components/ui";

export default function ExtrasLibraryPage() {
  const [extras, setExtras] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState("fixed");
  const [newValue, setNewValue] = useState("");
  const [originalExtrasById, setOriginalExtrasById] = useState({});


  async function load() {
  setLoading(true);

  const { data, error } = await supabase
    .from("extras_catalog")
    .select("id,name,type,default_value,allows_quantity,is_active")
    .order("name");

  if (error) {
    alert(error.message);
    setLoading(false);
    return;
  }

  const rows = data ?? [];

  setExtras(rows);

  // Snapshot for dirty detection
  const snapshot = {};
  rows.forEach((r) => {
    snapshot[r.id] = {
      name: r.name ?? "",
      type: r.type ?? "fixed",
      default_value: Number(r.default_value || 0),
      allows_quantity: !!r.allows_quantity,
      is_active: !!r.is_active,
    };
  });

  setOriginalExtrasById(snapshot);

  setLoading(false);
}



  async function createExtra() {
  if (!newName || newValue === "") return;

  const { error } = await supabase.from("extras_catalog").insert({
    name: newName,
    type: newType,
    default_value: Number(newValue),
    allows_quantity: newType === "fixed",
    is_active: true,
  });

  if (error) return alert(error.message);

  setNewName("");
  setNewValue("");
  setNewType("fixed");

  load();
}

async function updateExtra(id, patch) {
  const { error } = await supabase
    .from("extras_catalog")
    .update(patch)
    .eq("id", id);

  if (error) return alert(error.message);
  load();
}

async function deleteExtra(id) {
  const { error } = await supabase
    .from("extras_catalog")
    .delete()
    .eq("id", id);

  if (error) return alert(error.message);
  load();
}

function isDirty(row) {
  const orig = originalExtrasById[row.id];
  if (!orig) return false;

  const cur = {
    name: row.name ?? "",
    type: row.type ?? "fixed",
    default_value: Number(row.default_value || 0),
    allows_quantity: !!row.allows_quantity,
    is_active: !!row.is_active,
  };

  return (
    cur.name !== orig.name ||
    cur.type !== orig.type ||
    cur.default_value !== orig.default_value ||
    cur.allows_quantity !== orig.allows_quantity ||
    cur.is_active !== orig.is_active
  );
}


  useEffect(() => {
    load();
  }, []);

  if (loading) return <div className="p-6">Loading…</div>;

  return (
    <Page title="Extras Library">
      <Card>
        <CardHeader title="Extras" subtitle="Set default pricing here. Rooms pull from this list." />
        <CardBody>
            <div className="mb-6 p-4 rounded-xl border border-slate-200">
  <div className="font-medium mb-3">Add New Extra</div>

  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
    <Input
      placeholder="Name"
      value={newName}
      onChange={(e) => setNewName(e.target.value)}
    />

    <Select
      value={newType}
      onChange={(e) => setNewType(e.target.value)}
    >
      <option value="fixed">Fixed ($)</option>
      <option value="percent">Percent (%)</option>
    </Select>

    <Input
      type="number"
      placeholder="Default Value"
      value={newValue}
      onChange={(e) => setNewValue(e.target.value)}
    />

    <Button onClick={createExtra}>
      Add
    </Button>
  </div>
</div>

  {extras.map((x) => {
  const dirty = isDirty(x);

  return (
    <div
      key={x.id}
      className="p-4 rounded-xl border border-slate-200 flex flex-col md:flex-row md:items-center gap-4"
    >
      <div className="flex-1 grid grid-cols-1 md:grid-cols-4 gap-3">
        <div>
          <label className="text-xs text-slate-500">Name</label>
          <Input
            className="mt-1"
            value={x.name ?? ""}
            onChange={(e) =>
              setExtras((prev) =>
                prev.map((r) => (r.id === x.id ? { ...r, name: e.target.value } : r))
              )
            }
          />
        </div>

        <div>
          <label className="text-xs text-slate-500">Type</label>
          <Select
            className="mt-1"
            value={x.type ?? "fixed"}
            onChange={(e) => {
              const nextType = e.target.value;
              setExtras((prev) =>
                prev.map((r) => {
                  if (r.id !== x.id) return r;
                  const nextAllowsQty = nextType === "fixed" ? (r.allows_quantity ?? true) : false;
                  return { ...r, type: nextType, allows_quantity: nextAllowsQty };
                })
              );
            }}
          >
            <option value="fixed">Fixed ($)</option>
            <option value="percent">Percent (%)</option>
          </Select>
        </div>

        <div>
          <label className="text-xs text-slate-500">Default Value</label>
          <Input
            className="mt-1"
            type="number"
            value={x.default_value ?? ""}
            onChange={(e) =>
              setExtras((prev) =>
                prev.map((r) =>
                  r.id === x.id
                    ? { ...r, default_value: e.target.value === "" ? "" : Number(e.target.value) }
                    : r
                )
              )
            }
          />
        </div>

        <div className="flex items-end gap-3">
          <label className="inline-flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={!!x.allows_quantity}
              disabled={x.type === "percent"}
              onChange={(e) =>
                setExtras((prev) =>
                  prev.map((r) => (r.id === x.id ? { ...r, allows_quantity: e.target.checked } : r))
                )
              }
            />
            Qty
          </label>

          <label className="inline-flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={!!x.is_active}
              onChange={(e) =>
                setExtras((prev) =>
                  prev.map((r) => (r.id === x.id ? { ...r, is_active: e.target.checked } : r))
                )
              }
            />
            Active
          </label>
        </div>
      </div>

      <div className="flex gap-2 md:justify-end">
        {dirty && (
          <Button
            onClick={() =>
              updateExtra(x.id, {
                name: x.name,
                type: x.type,
                default_value: Number(x.default_value || 0),
                allows_quantity: !!x.allows_quantity,
                is_active: !!x.is_active,
              })
            }
          >
            Save
          </Button>
        )}

        <Button variant="danger" onClick={() => deleteExtra(x.id)}>
          Delete
        </Button>
      </div>
    </div>
  );
})}


        </CardBody>
      </Card>
    </Page>
  );
}
