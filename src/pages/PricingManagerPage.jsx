import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";
import { useNavigate } from "react-router-dom";
import { Page, Card, CardHeader, CardBody, Button, Input, Select, Pill } from "../components/ui";


function fmtRate(n) {
  const v = Number(n);
  if (Number.isNaN(v)) return "";
  return v.toFixed(2);
}
function cellKey(styleId, finishId) {
  return `${styleId}__${finishId}`;
}

export default function PricingManagerPage() {
    const nav = useNavigate();
  const [loading, setLoading] = useState(true);


  // Save states
  const [savingRates, setSavingRates] = useState(false);
  const [savingTiers, setSavingTiers] = useState(false);
  const [savingTypeDefaults, setSavingTypeDefaults] = useState(false);

  // Data lists
  const [tiers, setTiers] = useState([]);
  const [versions, setVersions] = useState([]);
  const [styles, setStyles] = useState([]);
  const [finishes, setFinishes] = useState([]);

  // Customer types defaults panel
  const [customerTypes, setCustomerTypes] = useState([]);
  const [typeDefaultEdits, setTypeDefaultEdits] = useState({}); // { typeId: default_tier_id|null }

  // Selected tier/version for matrix
  const [selectedTierId, setSelectedTierId] = useState("");
  const [selectedVersionId, setSelectedVersionId] = useState("");

  // Rates map
  const [ratesMap, setRatesMap] = useState({});
  const [ratesSnapshot, setRatesSnapshot] = useState({});

  // Tier editor
  const [newTierName, setNewTierName] = useState("");
  const [tierEdits, setTierEdits] = useState({}); // { tierId: { name?, is_active? } }

  const ratesDirty = useMemo(
    () => JSON.stringify(ratesMap) !== JSON.stringify(ratesSnapshot),
    [ratesMap, ratesSnapshot]
  );
  const tierDirtyCount = useMemo(() => Object.keys(tierEdits).length, [tierEdits]);

  const typeDefaultsDirty = useMemo(() => Object.keys(typeDefaultEdits).length > 0, [typeDefaultEdits]);

  async function loadBase() {
    setLoading(true);

    const [tRes, vRes, sRes, fRes, ctRes] = await Promise.all([
      supabase.from("pricing_tiers").select("id,name,is_active").order("name", { ascending: true }),
      supabase.from("pricing_versions").select("id,name,is_active").order("name", { ascending: true }),
      supabase
  .from("cabinet_styles")
  .select("id,name,sort_order")
  .order("sort_order", { ascending: true }),

      supabase
  .from("finish_types")
  .select("id,name,sort_order")
  .order("sort_order", { ascending: true }),

      supabase
        .from("customer_types")
        .select("id,name,sort_order,is_active,default_tier_id")
        .eq("is_active", true)
        .order("sort_order", { ascending: true }),
    ]);

    if (tRes.error) console.error(tRes.error);
    if (vRes.error) console.error(vRes.error);
    if (sRes.error) console.error(sRes.error);
    if (fRes.error) console.error(fRes.error);
    if (ctRes.error) console.error(ctRes.error);

    const tierList = tRes.data ?? [];
    const versionList = vRes.data ?? [];
    const styleList = sRes.data ?? [];
    const finishList = fRes.data ?? [];
    const typeList = ctRes.data ?? [];

    setTiers(tierList);
    setVersions(versionList);
    setStyles(styleList);
    setFinishes(finishList);
    setCustomerTypes(typeList);

    // Defaults for matrix selectors
    const activeTier = tierList.find((x) => x.is_active) || tierList[0];
    const activeVersion = versionList.find((x) => x.is_active) || versionList[0];
    setSelectedTierId(activeTier?.id || "");
    setSelectedVersionId(activeVersion?.id || "");

    setLoading(false);
  }

  useEffect(() => {
    loadBase();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load rates when tier/version changes
  useEffect(() => {
    let alive = true;

    async function loadRates() {
      if (!selectedTierId || !selectedVersionId) return;

      setRatesMap({});
      setRatesSnapshot({});

      const { data, error } = await supabase
        .from("pricing_rates")
        .select("cabinet_style_id, finish_type_id, rate_per_lf")
        .eq("tier_id", selectedTierId)
        .eq("pricing_version_id", selectedVersionId);

      if (error) {
        console.error(error);
        alert(error.message);
        return;
      }

      const map = {};
      (data ?? []).forEach((r) => {
        map[cellKey(r.cabinet_style_id, r.finish_type_id)] = Number(r.rate_per_lf ?? 0);
      });

      if (!alive) return;
      setRatesMap(map);
      setRatesSnapshot(map);
    }

    loadRates();
    return () => {
      alive = false;
    };
  }, [selectedTierId, selectedVersionId]);

  function setCell(styleId, finishId, value) {
    const k = cellKey(styleId, finishId);
    setRatesMap((prev) => {
      const next = { ...prev };
      if (value === "" || value === null || value === undefined) {
        delete next[k];
      } else {
        const num = Number(value);
        if (Number.isNaN(num)) return prev;
        next[k] = num;
      }
      return next;
    });
  }

  async function saveRates() {
    if (!selectedTierId || !selectedVersionId) return;

    setSavingRates(true);
    try {
      const rows = [];
      for (const s of styles) {
        for (const f of finishes) {
          const k = cellKey(s.id, f.id);
          if (ratesMap[k] === undefined) continue;
          rows.push({
            tier_id: selectedTierId,
            pricing_version_id: selectedVersionId,
            cabinet_style_id: s.id,
            finish_type_id: f.id,
            rate_per_lf: ratesMap[k],
          });
        }
      }

      // Requires unique index on (shop_id,tier_id,pricing_version_id,cabinet_style_id,finish_type_id)
      const { error } = await supabase
        .from("pricing_rates")
        .upsert(rows, { onConflict: "shop_id,tier_id,pricing_version_id,cabinet_style_id,finish_type_id" });

      if (error) throw error;

      setRatesSnapshot(ratesMap);
      alert("Rates saved.");
    } catch (e) {
      console.error(e);
      alert(e.message || "Failed to save rates");
    } finally {
      setSavingRates(false);
    }
  }

  function markTierEdit(tierId, patch) {
    setTierEdits((prev) => ({
      ...prev,
      [tierId]: { ...(prev[tierId] || {}), ...patch },
    }));
  }

  async function saveTierEdits() {
    if (tierDirtyCount === 0) return;
    setSavingTiers(true);
    try {
      const updates = Object.entries(tierEdits).map(([id, patch]) => ({ id, ...patch }));
      const { error } = await supabase.from("pricing_tiers").upsert(updates, { onConflict: "id" });
      if (error) throw error;

      setTierEdits({});
      await loadBase();
      alert("Tiers saved.");
    } catch (e) {
      console.error(e);
      alert(e.message || "Failed to save tiers");
    } finally {
      setSavingTiers(false);
    }
  }

  async function addTier() {
    const name = newTierName.trim();
    if (!name) return;

    try {
      const { data, error } = await supabase
        .from("pricing_tiers")
        .insert([{ name, is_active: true }])
        .select("id,name,is_active")
        .single();

      if (error) throw error;

      setNewTierName("");
      await loadBase();
      setSelectedTierId(data.id);
    } catch (e) {
      console.error(e);
      alert(e.message || "Failed to add tier");
    }
  }

  // Customer type defaults
  function setTypeDefault(typeId, tierIdOrNull) {
    setTypeDefaultEdits((prev) => ({
      ...prev,
      [typeId]: tierIdOrNull,
    }));
  }

  async function saveTypeDefaults() {
  if (!typeDefaultsDirty) return;

  setSavingTypeDefaults(true);
  try {
    const updates = Object.entries(typeDefaultEdits);

    for (const [id, defaultTierId] of updates) {
      const { error } = await supabase
        .from("customer_types")
        .update({ default_tier_id: defaultTierId || null })
        .eq("id", id);

      if (error) throw error;
    }

    setTypeDefaultEdits({});
    await loadBase();
    alert("Customer type defaults saved.");
  } catch (e) {
    console.error(e);
    alert(e.message || "Failed to save defaults");
  } finally {
    setSavingTypeDefaults(false);
  }
}


  if (loading) return <div className="p-6">Loading…</div>;

  return (
    <Page
      title="Pricing Manager"
      subtitle="Create tiers, edit rate-per-LF matrix, and set default tiers per customer type."
      actions={
  <Button variant="secondary" onClick={() => nav("/customers")}>
    Back
  </Button>
}

    >
      <div className="grid lg:grid-cols-3 gap-4">
        {/* Customer Type Defaults */}
        <Card className="lg:col-span-1">
          <CardHeader title="Customer Type Defaults" />
          <CardBody className="space-y-3">
            <div className="text-sm text-slate-600">
              Set the default pricing tier for each type (Builder/Designer/Customer).
            </div>

            <div className="space-y-2">
              {customerTypes.map((ct) => {
                const edited = typeDefaultEdits.hasOwnProperty(ct.id);
                const currentTierId = edited ? typeDefaultEdits[ct.id] : (ct.default_tier_id || "");
                return (
                  <div key={ct.id} className="rounded-xl border bg-white p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-medium text-slate-900">{ct.name}</div>
                      {edited ? <Pill tone="amber">Unsaved</Pill> : <Pill tone="green">Saved</Pill>}
                    </div>

                    <div className="mt-2">
                      <label className="text-xs text-slate-500">Default Tier</label>
                      <Select
                        className="mt-1"
                        value={currentTierId}
                        onChange={(e) => setTypeDefault(ct.id, e.target.value)}
                      >
                        <option value="">— None —</option>
                        {tiers.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </Select>
                    </div>
                  </div>
                );
              })}

              {customerTypes.length === 0 ? (
                <div className="text-sm text-slate-500">No active customer types.</div>
              ) : null}
            </div>

            <div className="pt-2">
              <Button
                disabled={!typeDefaultsDirty || savingTypeDefaults}
                onClick={saveTypeDefaults}
              >
                {savingTypeDefaults ? "Saving…" : "Save Defaults"}
              </Button>
            </div>
          </CardBody>
        </Card>

        {/* Pricing Tiers */}
        <Card className="lg:col-span-1">
          <CardHeader title="Pricing Tiers" />
          <CardBody className="space-y-4">
            <div className="flex gap-2">
              <Input
                placeholder="New tier name (ex: Builder)"
                value={newTierName}
                onChange={(e) => setNewTierName(e.target.value)}
              />
              <Button onClick={addTier}>Add</Button>
            </div>

            <div className="space-y-2">
              {tiers.map((t) => {
                const patch = tierEdits[t.id] || {};
                const name = patch.name ?? t.name;
                const isActive = patch.is_active ?? t.is_active;

                return (
                  <div key={t.id} className="rounded-xl border bg-white p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <div className="font-medium truncate">{t.id === selectedTierId ? `★ ${name}` : name}</div>
                          {isActive ? <Pill tone="green">Active</Pill> : <Pill tone="gray">Inactive</Pill>}
                        </div>
                      </div>

                      <Button
                        variant={t.id === selectedTierId ? "secondary" : "ghost"}
                        onClick={() => setSelectedTierId(t.id)}
                      >
                        Use
                      </Button>
                    </div>

                    <div className="mt-3 space-y-2">
                      <div>
                        <div className="text-xs text-slate-500 mb-1">Name</div>
                        <Input value={name} onChange={(e) => markTierEdit(t.id, { name: e.target.value })} />
                      </div>

                      <div className="flex items-center justify-between">
                        <div className="text-xs text-slate-500">Active</div>
                        <button
                          type="button"
                          className={`px-3 py-1 rounded-lg text-sm border ${
                            isActive
                              ? "bg-slate-900 text-white border-slate-900"
                              : "bg-white text-slate-700 border-slate-200"
                          }`}
                          onClick={() => markTierEdit(t.id, { is_active: !isActive })}
                        >
                          {isActive ? "Yes" : "No"}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}

              {tiers.length === 0 ? <div className="text-sm text-slate-500">No tiers yet.</div> : null}
            </div>
            <div className="pt-2 flex justify-end">
  <Button
    variant="secondary"
    disabled={tierDirtyCount === 0 || savingTiers}
    onClick={saveTierEdits}
  >
    {savingTiers ? "Saving…" : tierDirtyCount ? `Save Tiers (${tierDirtyCount})` : "Save Tiers"}
  </Button>
</div>

          </CardBody>
        </Card>

        {/* Rate Matrix */}
        <Card className="lg:col-span-1">
          <CardHeader
            title="Rate Matrix (per LF)"
            right={ratesDirty ? <Pill tone="amber">Unsaved</Pill> : <Pill tone="green">Saved</Pill>}
          />
          <CardBody className="space-y-3">
            <div className="grid md:grid-cols-2 gap-3">
              <div>
                <label className="text-sm text-slate-600">Pricing Version</label>
                <Select className="mt-1" value={selectedVersionId} onChange={(e) => setSelectedVersionId(e.target.value)}>
                  {versions.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                      {v.is_active ? "" : " (inactive)"}
                    </option>
                  ))}
                </Select>
              </div>

              <div>
                <label className="text-sm text-slate-600">Tier</label>
                <Select className="mt-1" value={selectedTierId} onChange={(e) => setSelectedTierId(e.target.value)}>
                  {tiers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                      {t.is_active ? "" : " (inactive)"}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            <div className="text-sm text-slate-500">
              Edit values as <b>rate per LF</b>. Blank means “no rate set”.
            </div>

            <div className="border rounded-2xl overflow-hidden">
  <table className="min-w-full">
    <thead className="bg-slate-100">
      <tr>
        <th className="text-left text-xs font-semibold text-slate-600 px-3 py-2 border-b">
          Cabinet Style
        </th>
        <th className="text-left text-xs font-semibold text-slate-600 px-3 py-2 border-b">
          Finish
        </th>
        <th className="text-left text-xs font-semibold text-slate-600 px-3 py-2 border-b">
          Rate per LF
        </th>
      </tr>
    </thead>
    <tbody>
      {styles.map((s) =>
        finishes.map((f) => {
          const k = cellKey(s.id, f.id);
          const val = ratesMap[k];

          return (
            <tr key={k} className="border-b last:border-0">
              <td className="px-3 py-2 text-sm text-slate-800">
                {s.name}
              </td>
              <td className="px-3 py-2 text-sm text-slate-600">
                {f.name}
              </td>
              <td className="px-3 py-2">
                <input
                  className="w-32 border rounded-lg px-2 py-1 text-sm tabular-nums"
                  value={val === undefined ? "" : fmtRate(val)}
                  placeholder="—"
                  onChange={(e) => setCell(s.id, f.id, e.target.value)}
                />
              </td>
            </tr>
          );
        })
      )}
    </tbody>
  </table>
</div>


            <div className="flex items-center justify-between pt-2">
              <div className="text-xs text-slate-500">
                Tip: set your Builder/Designer/Customer defaults on the left panel.
              </div>
              <Button disabled={!ratesDirty || savingRates} onClick={saveRates}>
                {savingRates ? "Saving…" : "Save Rates"}
              </Button>
            </div>
          </CardBody>
        </Card>
      </div>
    </Page>
  );
}
