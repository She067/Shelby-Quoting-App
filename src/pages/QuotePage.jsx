import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Page, Card, CardHeader, CardBody, Button, Pill, Select } from "../components/ui";
import { calcRoomPricing } from "../lib/PricingEngine";
import PlanMeasureDrawer from "../components/PlanMeasureDrawer";



function getManualLf(p) {
  return Number(p?.manual_lf ?? p?.manual_total_lf ?? 0);
}

function getPrimaryFinishId(p) {
  // variant_room_pricing uses finish_type_id in your table
  return p?.finish_type_id ?? p?.primary_finish_id ?? null;
}

function isRoomReady({ pricing, effectiveLf }) {
  if (!pricing) return false;

  const totalLf = pricing.lf_source === "manual" ? getManualLf(pricing) : Number(effectiveLf || 0);
  if (!totalLf || totalLf <= 0) return false;

  if (!pricing.cabinet_style_id) return false;
  if (!getPrimaryFinishId(pricing)) return false;

  if (pricing.has_mixed_finish) {
    if (!pricing.secondary_finish_id) return false;
    if (!pricing.secondary_lf || Number(pricing.secondary_lf) <= 0) return false;
  }

  return true;
}

export default function QuotePage() {
  const nav = useNavigate();
  const { id } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();

  const [loading, setLoading] = useState(false);
  const [quote, setQuote] = useState(null);

  const customerHref = useMemo(() => {
  return quote?.customer_id ? `/customers/${quote.customer_id}` : "/customers";
  }, [quote?.customer_id]);

  const [planDoc, setPlanDoc] = useState(null);
  const [planBusy, setPlanBusy] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);


  const [rooms, setRooms] = useState([]);
  const [segmentTotals, setSegmentTotals] = useState({});

  const [pricingMap, setPricingMap] = useState({});
  const [extrasByRoomId, setExtrasByRoomId] = useState({});

  const [styleMap, setStyleMap] = useState({});
  const [finishMap, setFinishMap] = useState({});

  const [tiers, setTiers] = useState([]);
  const [defaultTierId, setDefaultTierId] = useState(null);

  const [variants, setVariants] = useState([]);
  const [selectedVariantId, setSelectedVariantId] = useState(null);

  const [showAdd, setShowAdd] = useState(false);
  const [roomName, setRoomName] = useState("");

  const [recalcBusy, setRecalcBusy] = useState(false);
  const [variantBusy, setVariantBusy] = useState(false);

  const storageKey = useMemo(() => `quote:${id}:room_variant_id`, [id]);

  const activeVariant = useMemo(
    () => variants.find((x) => x.id === selectedVariantId) ?? null,
    [variants, selectedVariantId]
  );

  function getResolvedTierId() {
    const v = variants.find((x) => x.id === selectedVariantId);
    return v?.tier_id ?? quote?.tier_id ?? defaultTierId ?? null;
  }

  async function ensureBaseVariant(quoteRow) {
    const { data: list, error } = await supabase
      .from("room_variants")
      .select("id,quote_id,name,is_base,sort_order,tier_id")
      .eq("quote_id", quoteRow.id)
      .order("sort_order", { ascending: true });

    if (error) throw error;

    const existing = list ?? [];
    const norm = (s) => (s ?? "").trim().toLowerCase();

    let base =
      existing.find((v) => v.is_base) ||
      existing.find((v) => norm(v.name) === "base");

    if (!base) {
      const { data: createdRows, error: cErr } = await supabase
        .from("room_variants")
        .upsert(
          { quote_id: quoteRow.id, name: "Base", is_base: true, sort_order: 0, tier_id: null },
          { onConflict: "quote_id,name" }
        )
        .select("id,quote_id,name,is_base,sort_order,tier_id");

      if (cErr) throw cErr;
      base = createdRows?.[0];
      if (base) existing.unshift(base);
    }

    const sorted = [...existing].sort((a, b) => {
      if (a.is_base && !b.is_base) return -1;
      if (!a.is_base && b.is_base) return 1;
      return (a.sort_order ?? 0) - (b.sort_order ?? 0);
    });

    setVariants(sorted);

    const urlVariantId = searchParams.get("room_variant_id");
    const stored = localStorage.getItem(storageKey);
    const preferred = urlVariantId || stored || base?.id;
    const exists = sorted.some((v) => v.id === preferred);
    const nextSelected = exists ? preferred : base?.id;

    setSelectedVariantId(nextSelected);
    if (nextSelected) {
      localStorage.setItem(storageKey, nextSelected);
      setSearchParams((prev) => {
        const p = new URLSearchParams(prev);
        p.set("room_variant_id", nextSelected);
        return p;
      });
    }

    return { sorted, base, selectedId: nextSelected };
  }

  async function loadVariantData(roomVariantId, roomIds) {
  if (!roomVariantId) return;

  const safeRoomIds = (roomIds ?? []).filter((x) => typeof x === "string" && x.length > 0);
  if (!safeRoomIds.length) {
    setPricingMap({});
    setExtrasByRoomId({});
    return;
  }

  const { data: ps, error: psErr } = await supabase
    .from("variant_room_pricing")
    .select("*")
    .eq("room_variant_id", roomVariantId)
    .in("room_id", safeRoomIds);

  if (psErr) console.error("variant_room_pricing load error:", psErr);

  const pMap = {};
  (ps ?? []).forEach((row) => {
    if (!row.room_id) return;
    pMap[row.room_id] = row;
  });
  setPricingMap(pMap);

  const { data: ex, error: exErr } = await supabase
    .from("variant_room_extras")
    .select(`
      room_id,
      quantity,
      override_value,
      extras_catalog!variant_room_extras_extra_id_fkey (
        id,
        name,
        allows_quantity,
        is_active
      )
    `)
    .eq("room_variant_id", roomVariantId)
    .in("room_id", safeRoomIds);

  if (exErr) console.warn("variant_room_extras load error:", exErr.message);

  const eMap = {};
  (ex ?? []).forEach((row) => {
    const rid = row.room_id;
    const name = row.extras_catalog?.name;
    if (!rid || !name) return;

    const qty = Number(row.quantity || 1);
    const showQty = !!row.extras_catalog?.allows_quantity;
    const label = showQty && qty > 1 ? `${name} (${qty})` : name;

    eMap[rid] = eMap[rid] ?? [];
    eMap[rid].push(label);
  });
  setExtrasByRoomId(eMap);
}


 async function load() {
  setLoading(true);

  try {
    const { data: q, error: qErr } = await supabase
      .from("quotes")
      .select("id,quote_number,project_name,site_address,status,customer_id,created_at,tier_id")
      .eq("id", id)
      .single();

    if (qErr) throw qErr;
    setQuote(q);

    const { data: pd, error: pdErr } = await supabase
      .from("quote_plan_documents")
      .select("id, quote_id, pdf_url, storage_path, original_filename, page_count, scale_feet_per_pixel, scale_page_number")
      .eq("quote_id", q.id)
      .maybeSingle();

    if (pdErr) throw pdErr;
    setPlanDoc(pd ?? null);

    const { data: tierList, error: tErr } = await supabase
      .from("pricing_tiers")
      .select("id,name,is_active")
      .eq("is_active", true)
      .order("name", { ascending: true });
    if (tErr) throw tErr;
    setTiers(tierList ?? []);

    const { data: cust, error: custErr } = await supabase
      .from("customers")
      .select(`
        id,
        customer_types (
          id,
          default_tier_id
        )
      `)
      .eq("id", q.customer_id)
      .single();
    if (custErr) throw custErr;
    setDefaultTierId(cust?.customer_types?.default_tier_id ?? null);

    const variantInfo = await ensureBaseVariant(q);

    const { data: r, error: rErr } = await supabase
      .from("quote_rooms")
      .select("id,name,created_at")
      .eq("quote_id", id)
      .order("created_at", { ascending: true });
    if (rErr) throw rErr;

    const roomList = r ?? [];
    setRooms(roomList);

    const roomIds = roomList.map((x) => x.id);

    if (roomIds.length) {
      const { data: segs, error: sErr } = await supabase
        .from("room_plan_segments")
        .select("quote_room_id, lf_length")
        .in("quote_room_id", roomIds);

      if (sErr) throw sErr;

      const totals = {};
      (segs ?? []).forEach((s) => {
        totals[s.quote_room_id] = (totals[s.quote_room_id] ?? 0) + Number(s.lf_length || 0);
      });
      setSegmentTotals(totals);
    } else {
      setSegmentTotals({});
    }

    const [{ data: styles, error: stErr }, { data: finishes, error: fnErr }] = await Promise.all([
      supabase.from("cabinet_styles").select("id,name"),
      supabase.from("finish_types").select("id,name"),
    ]);

    if (stErr) throw stErr;
    if (fnErr) throw fnErr;

    setStyleMap(Object.fromEntries((styles ?? []).map((s) => [s.id, s.name])));
    setFinishMap(Object.fromEntries((finishes ?? []).map((f) => [f.id, f.name])));

    await loadVariantData(variantInfo.selectedId, roomIds);
  } catch (e) {
    console.error("QuotePage load failed:", e);
    alert(e?.message || "QuotePage failed to load. Check console for details.");
  } finally {
    setLoading(false);
  }
}


  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // ✅ when the user switches variants, reload totals without reloading the entire quote
  useEffect(() => {
    if (!selectedVariantId) return;
    if (!rooms?.length) return;

    localStorage.setItem(storageKey, selectedVariantId);
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      p.set("room_variant_id", selectedVariantId);
      return p;
    });

    loadVariantData(selectedVariantId, rooms.map((r) => r.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVariantId, rooms.length]);

  const roomTotals = useMemo(() => {
    const map = {};
    rooms.forEach((r) => {
      map[r.id] = Number(pricingMap?.[r.id]?.room_subtotal || 0);
    });
    return map;
  }, [rooms, pricingMap]);

  const quoteTotal = useMemo(() => {
    return rooms.reduce((sum, r) => sum + Number(pricingMap?.[r.id]?.room_subtotal || 0), 0);
  }, [rooms, pricingMap]);

  async function addRoom() {
  if (!roomName.trim()) return alert("Room name required");

  console.log("ADD ROOM clicked", { quote_id: id, roomName, selectedVariantId });

  const res = await supabase
    .from("quote_rooms")
    .insert({ quote_id: id, name: roomName.trim() })
    .select("id,name,created_at")
    .single();

  console.log("ADD ROOM result:", res);

  const { data, error } = res;

  if (error) {
    console.error("ADD ROOM ERROR FULL:", error);
    alert(`${error.message}\n\ncode: ${error.code || "—"}\nhint: ${error.hint || "—"}\ndetails: ${error.details || "—"}`);
    return;
  }

  setRooms((prev) => [...prev, data]);
  setRoomName("");
  setShowAdd(false);

  if (selectedVariantId) {
    const pr = await supabase.from("variant_room_pricing").insert({
      room_variant_id: selectedVariantId,
      room_id: data.id,
      lf_source: "manual",
      manual_lf: 0,
      has_mixed_finish: false,
    });

    console.log("ADD ROOM pricing row insert:", pr);

    if (pr.error) {
      console.error("PRICING ROW INSERT ERROR:", pr.error);
      alert(`Pricing row insert failed:\n${pr.error.message}`);
      return;
    }

    await loadVariantData(selectedVariantId, [...rooms.map((r) => r.id), data.id]);
  }
}

  async function createVariantClone() {
    if (!quote?.id) return;
    if (!selectedVariantId) return alert("No current variant selected.");

    const name = window.prompt("Variant name (example: C&S Stained Oak):");
    if (!name || !name.trim()) return;

    setVariantBusy(true);
    try {
      const nextSort = (variants.reduce((m, v) => Math.max(m, v.sort_order ?? 0), 0) || 0) + 1;

      const { data: vRow, error: vErr } = await supabase
        .from("room_variants")
        .insert({
          quote_id: quote.id,
          name: name.trim(),
          is_base: false,
          sort_order: nextSort,
          tier_id: null,
        })
        .select("id,quote_id,name,is_base,sort_order,tier_id")
        .single();

      if (vErr) throw vErr;

      // clone pricing rows
      const { data: pRows, error: pErr } = await supabase
        .from("variant_room_pricing")
        .select("*")
        .eq("room_variant_id", selectedVariantId);

      if (pErr) throw pErr;

      if ((pRows ?? []).length) {
        const inserts = pRows.map((r) => {
          const copy = { ...r };
          delete copy.id;
          copy.room_variant_id = vRow.id;
          return copy;
        });
        const { error: insErr } = await supabase.from("variant_room_pricing").insert(inserts);
        if (insErr) throw insErr;
      }

      // clone extras rows
      const { data: eRows, error: eErr } = await supabase
        .from("variant_room_extras")
        .select("*")
        .eq("room_variant_id", selectedVariantId);

      if (eErr) throw eErr;

      if ((eRows ?? []).length) {
        const inserts = eRows.map((r) => {
          const copy = { ...r };
          delete copy.id;
          copy.room_variant_id = vRow.id;
          return copy;
        });
        const { error: insErr } = await supabase.from("variant_room_extras").insert(inserts);
        if (insErr) throw insErr;
      }


      // refresh variant list + select new one
      await load();
      setSelectedVariantId(vRow.id);
    } catch (e) {
      console.error(e);
      alert(e.message || "Failed to create variant.");
    } finally {
      setVariantBusy(false);
    }
  }

  async function deleteSelectedVariant() {
  if (!selectedVariantId) return;

  const v = variants.find((x) => x.id === selectedVariantId);
  if (!v) return;

  if (v.is_base) {
    alert("You can’t delete the Base variant.");
    return;
  }

  const ok = window.confirm(
    `Delete variant "${v.name}"?\n\nThis will remove all saved pricing + extras for this variant.`
  );
  if (!ok) return;

  setVariantBusy(true);
  try {
    const { error: eErr } = await supabase
      .from("variant_room_extras")
      .delete()
      .eq("room_variant_id", selectedVariantId);
    if (eErr) throw eErr;

    const { error: pErr } = await supabase
      .from("variant_room_pricing")
      .delete()
      .eq("room_variant_id", selectedVariantId);
    if (pErr) throw pErr;

    const { error: vErr } = await supabase
      .from("room_variants")
      .delete()
      .eq("id", selectedVariantId);
    if (vErr) throw vErr;

    // reload variants
    const { data: list, error } = await supabase
      .from("room_variants")
      .select("id,quote_id,name,is_base,sort_order,tier_id")
      .eq("quote_id", quote.id)
      .order("sort_order", { ascending: true });

    if (error) throw error;

    const sorted = (list ?? []).sort((a, b) => {
      if (a.is_base && !b.is_base) return -1;
      if (!a.is_base && b.is_base) return 1;
      return (a.sort_order ?? 0) - (b.sort_order ?? 0);
    });

    setVariants(sorted);

    const baseId = sorted.find((x) => x.is_base)?.id ?? sorted[0]?.id ?? null;
    setSelectedVariantId(baseId);

    if (baseId && rooms?.length) {
      await loadVariantData(baseId, rooms.map((r) => r.id));
    }
  } catch (e) {
    console.error(e);
    alert(e.message || "Failed to delete variant.");
  } finally {
    setVariantBusy(false);
  }
}


  // NOTE: keeping your existing recalcAllRooms function as-is (not shown here)
  // If you want, paste your current recalcAllRooms into this file unchanged.

  async function recalcAllRooms() {
  if (!selectedVariantId) return;
  if (!rooms?.length) return;

  setRecalcBusy(true);
  try {
    // ✅ 1) Resolve tier correctly: variant -> quote -> default
    const resolvedTierId = getResolvedTierId();
    if (!resolvedTierId) {
      alert("No tier resolved. Set a default tier for the customer type or choose a tier override.");
      return;
    }

    // ✅ 2) Active pricing version
    const versionId = await getActivePricingVersionId();

    // ✅ 3) Pull pricing + extras for this variant
    const roomIds = rooms.map((r) => r.id);

    const { data: pricingRows, error: pErr } = await supabase
      .from("variant_room_pricing")
      .select("*")
      .eq("room_variant_id", selectedVariantId)
      .in("room_id", roomIds);

    if (pErr) throw pErr;

    const pricingByRoomId = {};
    (pricingRows ?? []).forEach((r) => {
      pricingByRoomId[r.room_id] = r;
    });

    const { data: extrasRows, error: eErr } = await supabase
      .from("variant_room_extras")
      .select(
        `
        room_id,
        quantity,
        override_value,
        extras_catalog!variant_room_extras_extra_id_fkey (
          id,
          type,
          default_value
        )
      `
      )
      .eq("room_variant_id", selectedVariantId)
      .in("room_id", roomIds);

    if (eErr) throw eErr;

    const extrasByRoom = {};
    (extrasRows ?? []).forEach((row) => {
      extrasByRoom[row.room_id] = extrasByRoom[row.room_id] ?? [];
      extrasByRoom[row.room_id].push(row);
    });

    // ✅ 4) Recalc each room
    for (const room of rooms) {
      const p = pricingByRoomId[room.id];

      // If a pricing row doesn't exist, skip (or create one if you prefer)
      if (!p) continue;

      const effectiveLf = Number(segmentTotals?.[room.id] || 0);
      const totalLf =
        p.lf_source === "manual" ? Number(p.manual_lf || 0) : effectiveLf;

      const cabinetStyleId = p.cabinet_style_id;
      const finishTypeId = getPrimaryFinishId(p);

      // If room isn't ready, set totals to 0 so it’s obvious
      if (!totalLf || !cabinetStyleId || !finishTypeId) {
        await supabase
          .from("variant_room_pricing")
          .update({
            lf_subtotal: 0,
            mixed_finish_delta: 0,
            room_subtotal: 0,
          })
          .eq("room_variant_id", selectedVariantId)
          .eq("room_id", room.id);

        continue;
      }

      const primaryRate = await getRatePerLf({
        tierId: resolvedTierId,
        versionId,
        cabinetStyleId,
        finishTypeId,
      });

      const mixed = {
        enabled: !!p.has_mixed_finish,
        secondaryFinishTypeId: p.secondary_finish_id ?? null,
        secondaryLf: Number(p.secondary_lf || 0),
        secondaryRate: 0,
      };

      if (mixed.enabled && mixed.secondaryFinishTypeId && mixed.secondaryLf > 0) {
        mixed.secondaryRate = await getRatePerLf({
          tierId: resolvedTierId,
          versionId,
          cabinetStyleId,
          finishTypeId: mixed.secondaryFinishTypeId,
        });
      }

      // Extras for this room
      const percentExtras = [];
      const fixedExtras = [];

      for (const row of extrasByRoom[room.id] ?? []) {
        const extra = row.extras_catalog;
        if (!extra) continue;

        const qty = Number(row.quantity || 1);
        const baseValue =
          row.override_value !== null && row.override_value !== undefined
            ? Number(row.override_value)
            : Number(extra.default_value || 0);

        if (extra.type === "percent") {
          percentExtras.push({ value: baseValue }); // stored as 10 for 10%
        } else {
          fixedExtras.push({ value: baseValue * qty });
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

      await supabase
        .from("variant_room_pricing")
        .update({
          lf_subtotal: result.lfSubtotal,
          mixed_finish_delta: result.mixedDelta,
          room_subtotal: result.finalSubtotal,
        })
        .eq("room_variant_id", selectedVariantId)
        .eq("room_id", room.id);
    }

    // ✅ 5) Reload data so UI updates immediately
    await loadVariantData(selectedVariantId, rooms.map((r) => r.id));

    console.log("✅ Recalc done. Tier:", resolvedTierId, "Variant:", selectedVariantId);
  } catch (e) {
    console.error(e);
    alert(e.message || "Recalc failed.");
  } finally {
    setRecalcBusy(false);
  }
}


async function getActivePricingVersionId() {
  const { data, error } = await supabase
    .from("pricing_versions")
    .select("id")
    .eq("is_active", true)
    .single();

  if (error) throw new Error("No active pricing version found.");
  return data.id;
}

async function getRatePerLf({ tierId, versionId, cabinetStyleId, finishTypeId }) {
  if (!tierId || !versionId || !cabinetStyleId || !finishTypeId) return 0;

  const { data, error } = await supabase
    .from("pricing_rates")
    .select("rate_per_lf")
    .eq("tier_id", tierId)
    .eq("pricing_version_id", versionId)
    .eq("cabinet_style_id", cabinetStyleId)
    .eq("finish_type_id", finishTypeId)
    .single();

  if (error) {
    console.warn("Rate lookup failed:", error.message, {
      tierId,
      versionId,
      cabinetStyleId,
      finishTypeId,
    });
    return 0;
  }

  return Number(data?.rate_per_lf || 0);
}

  async function uploadQuotePlanPdf(file) {
  if (!file) return;
  if (!quote?.id) return alert("Quote not loaded yet.");

  setPlanBusy(true);
  try {
    const bucket = "quote-plans";
    const cleanName = (file.name || "plan.pdf").replace(/[^\w.\-]+/g, "_");
    const path = `${quote.id}/${Date.now()}_${cleanName}`;

    const { error: upErr } = await supabase.storage.from(bucket).upload(path, file, {
      upsert: false,
      contentType: file.type || "application/pdf",
    });
    if (upErr) throw upErr;

    const { data: pub } = supabase.storage.from(bucket).getPublicUrl(path);
    const pdfUrl = pub?.publicUrl;
    if (!pdfUrl) throw new Error("Failed to get public URL for uploaded plan.");

    const { data: upserted, error: docErr } = await supabase
      .from("quote_plan_documents")
      .upsert(
        {
          quote_id: quote.id,
          pdf_url: pdfUrl,
          storage_path: path,
          original_filename: file.name || null,
          file_name: file.name || null,
          scale_feet_per_pixel: null,
          scale_page_number: null,
        },
        { onConflict: "quote_id" }
      )
      .select(
        "id, quote_id, pdf_url, storage_path, original_filename, page_count, scale_feet_per_pixel, scale_page_number"
      )
      .single();

    if (docErr) throw docErr;

    setPlanDoc(upserted);
    setPlanOpen(true);
  } catch (e) {
    console.error(e);
    alert(e.message || "Plan upload failed.");
  } finally {
    setPlanBusy(false);
  }
}


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

  // Only update if missing or wrong
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

if (loading && !quote) {
  return (
    <Page title="Quote">
      <div className="p-4 text-slate-600">Loading…</div>
    </Page>
  );
}


  return (

    <Page
      title={`Quote ${quote?.quote_number || ""}`}
     actions={
  <>
    <Button type="button" variant="secondary" onClick={() => nav(customerHref)}>
      ← Back
    </Button>

    <Button type="button" onClick={() => setShowAdd(true)}>
      + Add Room
    </Button>

    <Button
      type="button"
      variant="primary"
      disabled={rooms.length === 0}
      onClick={() => nav(`/quotes/${id}/pdf?room_variant_id=${selectedVariantId || ""}`)}
    >
      PDF
    </Button>
  </>
}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-slate-50 px-4 py-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-slate-500">Variant:</span>
          <Select
            className="w-56"
            value={selectedVariantId ?? ""}
            onChange={(e) => setSelectedVariantId(e.target.value || null)}
          >
            {(variants ?? []).map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
                {v.is_base ? " (Base)" : ""}
              </option>
            ))}
          </Select>

          <Button variant="secondary" size="sm" disabled={variantBusy} onClick={createVariantClone}>
            {variantBusy ? "..." : "+ Variant"}
          </Button>

          <Button
          variant="secondary"
          size="sm"
          disabled={variantBusy || !selectedVariantId || activeVariant?.is_base}
          onClick={deleteSelectedVariant}
          >
          Delete Variant
          </Button>


          <span className="ml-2 text-slate-500">Tier:</span>
          <Select
            className="w-56"
            value={activeVariant?.tier_id ?? ""}
            onChange={async (e) => {
              const nextTierId = e.target.value || null;
              if (!selectedVariantId) return;

              const { error } = await supabase
                .from("room_variants")
                .update({ tier_id: nextTierId })
                .eq("id", selectedVariantId);

              if (error) return alert(error.message);

              await load(); // keeps UI consistent
            }}
          >
            <option value="">
              Default ({tiers.find((t) => t.id === (quote?.tier_id ?? defaultTierId))?.name || "—"})
            </option>
            {tiers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>

          <Button variant="secondary" size="sm" disabled={recalcBusy || !selectedVariantId} onClick={recalcAllRooms}>
            {recalcBusy ? "..." : "Recalc"}
          </Button>
        </div>

        <div className="text-right">
          <div className="text-slate-500">Quote Total</div>
          <div className="font-semibold tabular-nums">${Number(quoteTotal || 0).toFixed(2)}</div>
        </div>
      </div>

      <Card className="mb-4">
        <CardHeader title="House Plan (Optional)" />
        <CardBody>
          {!planDoc ? (
  <div className="flex flex-wrap items-center justify-between gap-3">
    <div className="text-sm text-slate-600">
      Upload a PDF plan to measure linear footage. This is optional.
    </div>

    <label className="cursor-pointer">
      <input
        type="file"
        accept="application/pdf"
        className="hidden"
        disabled={planBusy}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) uploadQuotePlanPdf(f);
          e.target.value = "";
        }}
      />
      <span className="inline-flex items-center rounded-md bg-slate-800 text-white px-4 py-2 text-sm hover:bg-slate-700">
        {planBusy ? "Uploading..." : "Upload Plan PDF"}
      </span>
    </label>
  </div>
) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm text-slate-600">
                  Uploaded:{" "}
                  <span className="font-medium text-slate-800">
                    {planDoc.original_filename || "Plan.pdf"}
                  </span>
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  {planDoc.scale_feet_per_pixel ? (
                    <>Scale set ✅ (page {planDoc.scale_page_number || 1})</>
                  ) : (
                    <>Scale not set</>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <label className="cursor-pointer">
                  <input
                    type="file"
                    accept="application/pdf"
                    className="hidden"
                    disabled={planBusy}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) uploadQuotePlanPdf(f);
                      e.target.value = "";
                    }}
                  />
                  <span className="inline-flex items-center rounded-md border px-3 py-2 text-sm hover:bg-slate-50">
                    {planBusy ? "Uploading..." : "Replace PDF"}
                  </span>
                </label>

                <Button variant="secondary" onClick={() => setPlanOpen(true)}>
                  {planDoc.scale_feet_per_pixel ? "View / Measure" : "Set Scale"}
                </Button>
              </div>
            </div>
          )}
        </CardBody>
      </Card>

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

     <Card>
  <CardHeader title="Rooms" />
  <CardBody className="p-0">
    {/* List OR empty state */}
    {rooms.length === 0 ? (
      <div className="p-4 text-slate-600">No rooms yet. Click “Add Room”.</div>
    ) : (
      <ul className="divide-y">
        {rooms.map((r) => {
          const pricing = pricingMap[r.id];
          const eff = segmentTotals[r.id] ?? 0;
          const ready = isRoomReady({ pricing, effectiveLf: eff });

          const totalLf =
            pricing?.lf_source === "manual"
              ? getManualLf(pricing)
              : Number(segmentTotals[r.id] || 0);

          const styleName = pricing?.cabinet_style_id ? styleMap[pricing.cabinet_style_id] : null;
          const finishName = getPrimaryFinishId(pricing) ? finishMap[getPrimaryFinishId(pricing)] : null;

          return (
            <li key={r.id} className="px-4 py-3 flex items-center justify-between">
              <div className="min-w-0">
                <div className="font-medium truncate">{r.name}</div>

                <div className="mt-1 text-xs text-slate-600 flex flex-wrap gap-x-4 gap-y-1">
                  <div>
                    LF: <span className="font-medium tabular-nums">{Number(totalLf || 0).toFixed(2)}</span>
                  </div>
                  <div>
                    Style: <span className="font-medium">{styleName || "—"}</span>
                  </div>
                  <div>
                    Finish: <span className="font-medium">{finishName || "—"}</span>
                  </div>
                  {(extrasByRoomId?.[r.id]?.length ?? 0) > 0 && (
                    <div className="truncate">Extras: {extrasByRoomId[r.id].join(", ")}</div>
                  )}
                </div>

                <div className="mt-2">
                  {ready ? <Pill tone="green">Ready</Pill> : <Pill tone="amber">Needs info</Pill>}
                </div>
              </div>

              <div className="flex items-center gap-6">
                <div className="text-right">
                  <div className="text-sm text-slate-500">Room Total</div>
                  <div className="font-semibold tabular-nums">
                    ${Number(roomTotals[r.id] || 0).toFixed(2)}
                  </div>
                </div>

                <Link
                  className="text-sm font-medium text-slate-700 hover:underline"
                  to={`/quotes/${id}/rooms/${r.id}?room_variant_id=${selectedVariantId || ""}`}
                >
                  Edit
                </Link>
              </div>
            </li>
          );
        })}
      </ul>
    )}

    {/* ✅ Add Room form (always available even when rooms is empty) */}
    {showAdd && (
      <div className="p-4 border-t bg-white flex flex-wrap items-end gap-2">
        <div className="min-w-[240px]">
          <div className="text-xs text-slate-500">Room Name</div>
          <input
            className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
            value={roomName}
            onChange={(e) => setRoomName(e.target.value)}
            placeholder="Kitchen, Master Bath, etc."
          />
        </div>
        <Button onClick={addRoom}>Add</Button>
        <Button variant="secondary" onClick={() => setShowAdd(false)}>
          Cancel
        </Button>
      </div>
    )}
  </CardBody>
</Card>
    </Page>
  );
}
