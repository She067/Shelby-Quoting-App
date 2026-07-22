import React, { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Page, Card, CardHeader, CardBody, Button, Input, Select } from "../components/ui";
import { calcRoomPricing } from "../lib/pricingEngine";
import PlanMeasureDrawer from "../components/PlanMeasureDrawer";

export default function RoomEditorPage() {
  const nav = useNavigate();
  const { quoteId, roomId } = useParams();
  const [searchParams] = useSearchParams();
  const roomVariantIdFromUrl = searchParams.get("room_variant_id");

  const [loading, setLoading] = useState(false);

  const [pricing, setPricing] = useState(null);
  const [pricingContext, setPricingContext] = useState(null);

  const [styles, setStyles] = useState([]);
  const [finishes, setFinishes] = useState([]);
  const [extrasCatalog, setExtrasCatalog] = useState([]);

  const [roomExtras, setRoomExtras] = useState([]);
  const [planOpen, setPlanOpen] = useState(false);

  // ✅ pull plan doc same way as QuotePage
  const [planDoc, setPlanDoc] = useState(null);

  // ✅ critical: we must always know which variant we're editing
  const [effectiveRoomVariantId, setEffectiveRoomVariantId] = useState(null);

  async function load() {
    setLoading(true);

    let effectiveVariantId = roomVariantIdFromUrl;

    try {
      // If URL param missing, fallback to Base
      if (!effectiveVariantId) {
        const { data: vRows, error: vErr } = await supabase
          .from("room_variants")
          .select("id")
          .eq("quote_id", quoteId)
          .eq("is_base", true)
          .limit(1);

        if (vErr) return alert(vErr.message);
        effectiveVariantId = vRows?.[0]?.id || null;
      }

      if (!effectiveVariantId) {
        alert("No Base variant found for this quote.");
        return;
      }

      setEffectiveRoomVariantId(effectiveVariantId);

      // pricing row (create if missing)
      const { data: rows, error: pErr } = await supabase
        .from("variant_room_pricing")
        .select("*")
        .eq("room_variant_id", effectiveVariantId)
        .eq("room_id", roomId)
        .limit(1);

      if (pErr) return alert(pErr.message);

      let p = rows?.[0];

      if (!p) {
        const { data: created, error: cErr } = await supabase
          .from("variant_room_pricing")
          .insert({
            room_variant_id: effectiveVariantId,
            room_id: roomId,
            lf_source: "manual",
            manual_lf: 0,
            has_mixed_finish: false,
          })
          .select("*")
          .limit(1);

        if (cErr) return alert(cErr.message);
        p = created?.[0];
      }

      // normalize fields used by UI
      const uiPricing = {
        ...p,
        manual_total_lf: Number(p.manual_lf ?? 0),
        primary_finish_id: p.primary_finish_id ?? p.finish_type_id ?? null,
      };

      setPricing(uiPricing);

      // ✅ Load plan doc for this quote (same as QuotePage)
      const { data: pd, error: pdErr } = await supabase
        .from("quote_plan_documents")
        .select(
          "id, quote_id, pdf_url, storage_path, original_filename, page_count, scale_feet_per_pixel, scale_page_number"
        )
        .eq("quote_id", quoteId)
        .maybeSingle();

      if (pdErr) {
        console.warn("quote_plan_documents load failed:", pdErr.message);
        setPlanDoc(null);
      } else {
        setPlanDoc(pd ?? null);
      }

      // Resolve tier (quote override -> customer type default)
      const { data: q, error: qErr } = await supabase
        .from("quotes")
        .select(`
          id,
          tier_id,
          customers (
            id,
            customer_types (
              id,
              default_tier_id
            )
          )
        `)
        .eq("id", quoteId)
        .single();

      if (qErr) return alert(qErr.message);

      const resolvedTierId = q.tier_id ?? q.customers?.customer_types?.default_tier_id ?? null;

      if (!resolvedTierId) {
        alert("No pricing tier is set. Set a default tier for this customer type in Pricing Manager.");
        return;
      }

      // Active pricing version
      const { data: v, error: vErr } = await supabase
        .from("pricing_versions")
        .select("id")
        .eq("is_active", true)
        .single();

      if (vErr) {
        alert("No active pricing version found. Set one active in Pricing Versions.");
        return;
      }

      setPricingContext({
        tierId: resolvedTierId,
        versionId: v.id,
      });

      const { data: s } = await supabase
        .from("cabinet_styles")
        .select("id,name,sort_order")
        .eq("is_active", true)
        .order("sort_order");

      const { data: f } = await supabase
        .from("finish_types")
        .select("id,name,sort_order")
        .eq("is_active", true)
        .order("sort_order");

      setStyles(s ?? []);
      setFinishes(f ?? []);

      const { data: ec, error: ecErr } = await supabase
        .from("extras_catalog")
        .select("id,name,type,default_value,allows_quantity,is_active")
        .eq("is_active", true)
        .order("name");

      if (ecErr) return alert(ecErr.message);
      setExtrasCatalog(ec ?? []);

      // ✅ extras come from variant_room_extras
      const extrasRows = await loadRoomExtras(effectiveVariantId);
      setRoomExtras(extrasRows);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  async function getRatePerLf({ tierId, versionId, cabinetStyleId, finishTypeId }) {
    if (!tierId || !versionId || !cabinetStyleId || !finishTypeId) return null;

    const { data, error } = await supabase
      .from("pricing_rates")
      .select("rate_per_lf")
      .eq("tier_id", tierId)
      .eq("pricing_version_id", versionId)
      .eq("cabinet_style_id", cabinetStyleId)
      .eq("finish_type_id", finishTypeId)
      .single();

    if (error) {
      console.warn("Rate lookup failed:", error.message);
      return null;
    }

    return Number(data?.rate_per_lf || 0);
  }

  async function loadRoomExtras(roomVariantId) {
    if (!roomVariantId) return [];

    const { data, error } = await supabase
      .from("variant_room_extras")
      .select(`
        id,
        room_id,
        extra_catalog_id,
        quantity,
        override_value,
        extras_catalog!variant_room_extras_extra_catalog_id_fkey (
          id,
          name,
          type,
          default_value,
          allows_quantity,
          is_active
        )
      `)
      .eq("room_variant_id", roomVariantId)
      .eq("room_id", roomId);

    if (error) {
      console.warn("loadRoomExtras error:", error.message);
      return [];
    }

    return data ?? [];
  }

  async function refreshRoomExtrasAndRecalc(nextPricing = pricing) {
    if (!effectiveRoomVariantId) return;
    const rows = await loadRoomExtras(effectiveRoomVariantId);
    setRoomExtras(rows);
    await recalcAndSave(nextPricing, rows);
  }

  async function addExtra(extraId) {
    if (!effectiveRoomVariantId) return;
    if (!extraId) return;

    const { error } = await supabase.from("variant_room_extras").insert({
      room_variant_id: effectiveRoomVariantId,
      room_id: roomId,
      extra_catalog_id: extraId,
      quantity: 1,
      override_value: null,
    });

    if (error) return alert(error.message);

    await refreshRoomExtrasAndRecalc();
  }

  async function updateRoomExtra(extraRowId, patch) {
    if (!effectiveRoomVariantId) return;

    const { error } = await supabase.from("variant_room_extras").update(patch).eq("id", extraRowId);
    if (error) return alert(error.message);

    await refreshRoomExtrasAndRecalc();
  }

  async function removeRoomExtra(extraRowId) {
    const { error } = await supabase.from("variant_room_extras").delete().eq("id", extraRowId);
    if (error) return alert(error.message);

    await refreshRoomExtrasAndRecalc();
  }

  async function recalcAndSave(nextPricing, extrasRows = roomExtras) {
    if (!pricingContext) return;
    if (!effectiveRoomVariantId) return;

    const totalLf = nextPricing.lf_source === "manual" ? Number(nextPricing.manual_total_lf || 0) : 0;

    const cabinetStyleId = nextPricing.cabinet_style_id;
    const finishTypeId = nextPricing.primary_finish_id;

    if (!cabinetStyleId || !finishTypeId) {
      await supabase
        .from("variant_room_pricing")
        .update({
          lf_source: nextPricing.lf_source,
          manual_lf: Number(nextPricing.manual_total_lf || 0),
          cabinet_style_id: cabinetStyleId ?? null,
          primary_finish_id: finishTypeId ?? null,
          finish_type_id: finishTypeId ?? null,
          has_mixed_finish: !!nextPricing.has_mixed_finish,
          secondary_finish_id: nextPricing.secondary_finish_id ?? null,
          secondary_lf: Number(nextPricing.secondary_lf || 0),
        })
        .eq("room_variant_id", effectiveRoomVariantId)
        .eq("room_id", roomId);

      return;
    }

    const primaryRate = await getRatePerLf({
      tierId: pricingContext.tierId,
      versionId: pricingContext.versionId,
      cabinetStyleId,
      finishTypeId,
    });

    const mixed = {
      enabled: !!nextPricing.has_mixed_finish,
      secondaryFinishTypeId: nextPricing.secondary_finish_id ?? null,
      secondaryLf: Number(nextPricing.secondary_lf || 0),
      secondaryRate: null,
    };

    if (mixed.enabled && mixed.secondaryFinishTypeId) {
      mixed.secondaryRate = await getRatePerLf({
        tierId: pricingContext.tierId,
        versionId: pricingContext.versionId,
        cabinetStyleId,
        finishTypeId: mixed.secondaryFinishTypeId,
      });
    }

    const percentExtras = [];
    const fixedExtras = [];

    for (const row of extrasRows || []) {
      const extra = row.extras_catalog;
      if (!extra) continue;

      const qty = extra.allows_quantity ? Math.max(1, Number(row.quantity || 1)) : 1;

      if (extra.type === "percent") {
        percentExtras.push({ value: Number(extra.default_value || 0) });
      } else {
        fixedExtras.push({ value: Number(extra.default_value || 0) * qty });
      }
    }

    const result = calcRoomPricing({
      totalLf,
      primaryRate: Number(primaryRate || 0),
      mixed,
      percentExtras,
      fixedExtras,
      appliancePanelsTotal: 0,
    });

    const computedPatch = {
      lf_subtotal: result.lfSubtotal,
      mixed_finish_delta: result.mixedDelta,
      room_subtotal: result.finalSubtotal,
    };

    setPricing((prev) => ({ ...prev, ...computedPatch }));

    const dbPatch = {
      lf_source: nextPricing.lf_source,
      manual_lf: Number(nextPricing.manual_total_lf || 0),
      cabinet_style_id: cabinetStyleId,
      primary_finish_id: finishTypeId,
      finish_type_id: finishTypeId,
      has_mixed_finish: !!nextPricing.has_mixed_finish,
      secondary_finish_id: nextPricing.secondary_finish_id,
      secondary_lf: Number(nextPricing.secondary_lf || 0),
      lf_subtotal: result.lfSubtotal,
      mixed_finish_delta: result.mixedDelta,
      room_subtotal: result.finalSubtotal,
    };

    const { error } = await supabase
      .from("variant_room_pricing")
      .update(dbPatch)
      .eq("room_variant_id", effectiveRoomVariantId)
      .eq("room_id", roomId);

    if (error) alert(error.message);
  }

  async function save(patch, { recalc = false } = {}) {
    setPricing((prev) => {
      const merged = { ...prev, ...patch };
      if (recalc) recalcAndSave(merged);
      return merged;
    });
  }

  // Optional: save scale from room editor too (so it persists)
  async function savePlanScale({ scaleFeetPerPixel, scalePageNumber }) {
    if (!planDoc?.id) return;

    const { data, error } = await supabase
      .from("quote_plan_documents")
      .update({
        scale_feet_per_pixel: Number(scaleFeetPerPixel),
        scale_page_number: Number(scalePageNumber),
      })
      .eq("id", planDoc.id)
      .select("id, quote_id, pdf_url, storage_path, original_filename, page_count, scale_feet_per_pixel, scale_page_number")
      .single();

    if (error) {
      alert(error.message);
      return;
    }
    setPlanDoc(data);
  }

  async function savePlanPageCount(numPages) {
    if (!planDoc?.id) return;
    if (!numPages) return;

    if (Number(planDoc.page_count || 0) === Number(numPages)) return;

    const { data, error } = await supabase
      .from("quote_plan_documents")
      .update({ page_count: Number(numPages) })
      .eq("id", planDoc.id)
      .select("id, quote_id, pdf_url, storage_path, original_filename, page_count, scale_feet_per_pixel, scale_page_number")
      .single();

    if (error) {
      console.warn("Failed to update page_count:", error.message);
      return;
    }

    setPlanDoc(data);
  }

  if (loading || !pricing) {
    return (
      <Page title="Room Editor">
        <div className="p-4 text-slate-600">Loading…</div>
      </Page>
    );
  }

  const selectedExtraIds = new Set(
    (roomExtras ?? []).map((x) => x.extra_catalog_id ?? x.extras_catalog?.id).filter(Boolean)
  );

  const canOpenPlan = !!planDoc?.pdf_url;

  return (
    <Page
      title="Room Editor"
      actions={
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => nav(-1)}>
            Back
          </Button>
          <Link
            className="text-sm font-medium text-slate-700 hover:underline"
            to={`/quotes/${quoteId}?room_variant_id=${effectiveRoomVariantId || ""}`}
          >
            Submit
          </Link>
        </div>
      }
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Pricing Inputs" />
          <CardBody className="space-y-4">
            <div>
              <label className="text-sm text-slate-600">LF Source</label>
              <Select
                className="mt-1"
                value={pricing.lf_source || "manual"}
                onChange={(e) => save({ lf_source: e.target.value }, { recalc: true })}
              >
                <option value="manual">Manual</option>
              </Select>
            </div>

            <div>
              <label className="text-sm text-slate-600">Total LF</label>
              <div className="mt-1 flex items-center gap-2">
                <Input
                  className="flex-1"
                  type="number"
                  value={pricing.manual_total_lf ?? ""}
                  onChange={(e) =>
                    save(
                      { manual_total_lf: e.target.value === "" ? null : Number(e.target.value) },
                      { recalc: true }
                    )
                  }
                />
                <Button
                  variant="secondary"
                  type="button"
                  onClick={() => {
                    if (!canOpenPlan) {
                      alert("No plan PDF uploaded for this quote. Upload it on the Quote page first.");
                      return;
                    }
                    setPlanOpen(true);
                  }}
                  disabled={!canOpenPlan}
                  title={!canOpenPlan ? "Upload a plan PDF on the Quote page first" : ""}
                >
                  Measure on Plan
                </Button>
              </div>
            </div>

            <div>
              <label className="text-sm text-slate-600">Cabinet Style</label>
              <Select
                className="mt-1"
                value={pricing.cabinet_style_id ?? ""}
                onChange={(e) => save({ cabinet_style_id: e.target.value || null }, { recalc: true })}
              >
                <option value="">Select…</option>
                {styles.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <label className="text-sm text-slate-600">Primary Finish</label>
              <Select
                className="mt-1"
                value={pricing.primary_finish_id ?? ""}
                onChange={(e) => save({ primary_finish_id: e.target.value || null }, { recalc: true })}
              >
                <option value="">Select…</option>
                {finishes.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </Select>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={!!pricing.has_mixed_finish}
                onChange={(e) => save({ has_mixed_finish: e.target.checked }, { recalc: true })}
              />
              <span className="text-sm text-slate-700">Mixed Finish</span>
            </div>

            {pricing.has_mixed_finish && (
              <>
                <div>
                  <label className="text-sm text-slate-600">Secondary Finish</label>
                  <Select
                    className="mt-1"
                    value={pricing.secondary_finish_id ?? ""}
                    onChange={(e) => save({ secondary_finish_id: e.target.value || null }, { recalc: true })}
                  >
                    <option value="">Select…</option>
                    {finishes.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </Select>
                </div>

                <div>
                  <label className="text-sm text-slate-600">Secondary LF</label>
                  <Input
                    className="mt-1"
                    type="number"
                    value={pricing.secondary_lf ?? ""}
                    onChange={(e) =>
                      save({ secondary_lf: e.target.value === "" ? 0 : Number(e.target.value) }, { recalc: true })
                    }
                  />
                </div>
              </>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Extras" />
          <CardBody className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium text-slate-700">Extras Library</div>
              <Link to="/extras">
                <Button variant="secondary" size="sm">
                  Manage Extras
                </Button>
              </Link>
            </div>

            <div>
              <label className="text-sm text-slate-600">Add Extra</label>
              <Select
                className="mt-1"
                value=""
                onChange={(e) => {
                  const extraId = e.target.value;
                  if (!extraId) return;
                  addExtra(extraId);
                }}
              >
                <option value="">Select…</option>
                {extrasCatalog
                  .filter((x) => !selectedExtraIds.has(x.id))
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
              </Select>
            </div>

            {(roomExtras ?? []).length === 0 ? (
              <div className="text-sm text-slate-600">No extras selected.</div>
            ) : (
              <div className="space-y-3">
                {roomExtras.map((row) => {
                  const extra = row.extras_catalog;
                  const allowsQty = !!extra?.allows_quantity;

                  return (
                    <div key={row.id} className="rounded-lg border bg-white p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="font-medium text-slate-800">{extra?.name || "Extra"}</div>
                        <Button variant="secondary" size="sm" onClick={() => removeRoomExtra(row.id)}>
                          Remove
                        </Button>
                      </div>

                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        {allowsQty && (
                          <div>
                            <label className="text-xs text-slate-500">Qty</label>
                            <Input
                              type="number"
                              value={row.quantity ?? 1}
                              onChange={(e) => updateRoomExtra(row.id, { quantity: Number(e.target.value || 1) })}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Totals" />
          <CardBody className="grid gap-3 sm:grid-cols-3">
            <div>
              <div className="text-sm text-slate-500">LF Subtotal</div>
              <div className="font-semibold tabular-nums">${Number(pricing.lf_subtotal || 0).toFixed(2)}</div>
            </div>
            <div>
              <div className="text-sm text-slate-500">Mixed Finish Delta</div>
              <div className="font-semibold tabular-nums">${Number(pricing.mixed_finish_delta || 0).toFixed(2)}</div>
            </div>
            <div>
              <div className="text-sm text-slate-500">Room Subtotal</div>
              <div className="font-semibold tabular-nums">${Number(pricing.room_subtotal || 0).toFixed(2)}</div>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* ✅ Drawer now has the SAME pdfUrl data as QuotePage */}
      <PlanMeasureDrawer
        open={planOpen}
        onClose={() => setPlanOpen(false)}
        pdfUrl={planDoc?.pdf_url || ""}
        initialScaleFpp={planDoc?.scale_feet_per_pixel ?? null}
        initialScalePage={planDoc?.scale_page_number ?? null}
        pageCount={planDoc?.page_count ?? null}
        onSaveScale={savePlanScale}
        title={planDoc?.original_filename || "House Plan"}
        leftPanelTop={null}
        onDetectedPageCount={savePlanPageCount}
      />
    </Page>
  );
}