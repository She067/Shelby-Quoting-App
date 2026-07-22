import React, { useEffect, useMemo, useState } from "react";
import { useParams, Link, useSearchParams } from "react-router-dom";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { supabase } from "../supabaseClient";
import { Page, Card, CardHeader, CardBody, Button, Pill } from "../components/ui";
import logoUrl from "../assets/shelby-logo.png";

function money(n) {
  const v = Number(n || 0);
  return v.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function joinNonEmpty(parts, sep = " • ") {
  return parts
    .map((x) => (x ?? "").toString().trim())
    .filter(Boolean)
    .join(sep);
}

export default function QuotePdfPage() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [quote, setQuote] = useState(null);
  const [rooms, setRooms] = useState([]);
  const [pricingMap, setPricingMap] = useState({});
  const [extrasByRoomId, setExtrasByRoomId] = useState({});
  const [styleMap, setStyleMap] = useState({});
  const [finishMap, setFinishMap] = useState({});

  const [variants, setVariants] = useState([]);
  const [selectedVariantId, setSelectedVariantId] = useState(null);
  const [selectedVariantName, setSelectedVariantName] = useState("Base");

  const quoteTotal = useMemo(() => {
    return rooms.reduce((sum, r) => sum + Number(pricingMap?.[r.id]?.room_subtotal || 0), 0);
  }, [rooms, pricingMap]);

  // ✅ helper: extras line (used by BOTH preview + PDF)
  function buildExtrasLine(roomId) {
    const extras = extrasByRoomId?.[roomId] || [];
    if (!extras.length) return "";

    return extras
      .map((x) => {
        const cat = x?.extras_catalog;
        const name = cat?.name || "";
        if (!name) return "";

        const allowsQty = !!cat?.allows_quantity;
        const qty = Math.max(1, Number(x?.quantity || 1));

        // only show qty if that extra supports qty AND qty > 1
        return allowsQty && qty > 1 ? `${name} (${qty})` : name;
      })
      .filter(Boolean)
      .join(", ");
  }

  useEffect(() => {
    let alive = true;

    async function load() {
      setLoading(true);

      // clear state
      setQuote(null);
      setRooms([]);
      setPricingMap({});
      setExtrasByRoomId({});
      setStyleMap({});
      setFinishMap({});
      setVariants([]);
      setSelectedVariantId(null);
      setSelectedVariantName("Base");

      // Quote
      const { data: q, error: qErr } = await supabase
        .from("quotes")
        .select("id,quote_number,project_name,site_address,status,customer_id,created_at,customers(name)")
        .eq("id", id)
        .single();

      if (qErr) {
        console.error(qErr);
        alert(qErr.message);
        if (alive) setLoading(false);
        return;
      }
      if (!alive) return;
      setQuote(q);

      // Rooms
      const { data: r, error: rErr } = await supabase
        .from("quote_rooms")
        .select("id,name,created_at")
        .eq("quote_id", id)
        .order("created_at", { ascending: true });

      if (rErr) {
        console.error(rErr);
        alert(rErr.message);
        if (alive) setLoading(false);
        return;
      }

      const roomList = r ?? [];
      if (!alive) return;
      setRooms(roomList);

      // Variants
      const { data: vList, error: vErr } = await supabase
        .from("room_variants")
        .select("id,name,is_base,sort_order,tier_id")
        .eq("quote_id", id)
        .order("sort_order", { ascending: true });

      if (vErr) console.error(vErr);

      const sortedVariants = (vList ?? []).sort((a, b) => {
        if (a.is_base && !b.is_base) return -1;
        if (!a.is_base && b.is_base) return 1;
        return (a.sort_order ?? 0) - (b.sort_order ?? 0);
      });

      if (!alive) return;
      setVariants(sortedVariants);

      const urlVariantId = searchParams.get("room_variant_id");
      const baseId = sortedVariants.find((x) => x.is_base)?.id ?? sortedVariants[0]?.id ?? null;

      const effectiveVariantId =
        urlVariantId && sortedVariants.some((v) => v.id === urlVariantId) ? urlVariantId : baseId;

      setSelectedVariantId(effectiveVariantId);

      const vName = sortedVariants.find((v) => v.id === effectiveVariantId)?.name ?? "Base";
      setSelectedVariantName(vName);

      // Pricing + extras for selected variant
      if (roomList.length && effectiveVariantId) {
        const roomIds = roomList.map((x) => x.id);

        // ✅ variant_room_pricing
        const { data: vp, error: vpErr } = await supabase
          .from("variant_room_pricing")
          .select(
            "room_id,room_subtotal,cabinet_style_id,finish_type_id,primary_finish_id,has_mixed_finish,secondary_finish_id"
          )
          .eq("room_variant_id", effectiveVariantId)
          .in("room_id", roomIds);

        if (vpErr) console.error(vpErr);

        const pMap = {};
        (vp ?? []).forEach((row) => {
          pMap[row.room_id] = row;
        });
        if (!alive) return;
        setPricingMap(pMap);

        // ✅ variant_room_extras
        // IMPORTANT: use the FK that matches your schema: extra_catalog_id -> extras_catalog
        const { data: ex, error: exErr } = await supabase
          .from("variant_room_extras")
          .select(`
            id,
            room_id,
            quantity,
            extra_catalog_id,
            extras_catalog!variant_room_extras_extra_catalog_id_fkey (
              id,
              name,
              type,
              default_value,
              allows_quantity,
              is_active
            )
          `)
          .eq("room_variant_id", effectiveVariantId)
          .in("room_id", roomIds);

        if (exErr) console.error(exErr);

        const byRoom = {};
        (ex ?? []).forEach((row) => {
          const rid = row.room_id;
          if (!byRoom[rid]) byRoom[rid] = [];
          byRoom[rid].push(row);
        });

        if (!alive) return;
        setExtrasByRoomId(byRoom);
      }

      // Lookup maps
      const [{ data: styles, error: sErr }, { data: finishes, error: fErr }] = await Promise.all([
        supabase.from("cabinet_styles").select("id,name"),
        supabase.from("finish_types").select("id,name"),
      ]);

      if (sErr) console.error(sErr);
      if (fErr) console.error(fErr);

      const sMap = {};
      (styles ?? []).forEach((x) => (sMap[x.id] = x.name));

      const fMap = {};
      (finishes ?? []).forEach((x) => (fMap[x.id] = x.name));

      if (!alive) return;
      setStyleMap(sMap);
      setFinishMap(fMap);

      setLoading(false);
    }

    load();

    return () => {
      alive = false;
    };
  }, [id, searchParams]);

  async function buildPdf() {
    if (!quote) return;
    setBusy(true);

    try {
      const pdfDoc = await PDFDocument.create();
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

      const pageWidth = 612;
      const pageHeight = 792;

      const margin = 48;
      const contentWidth = pageWidth - margin * 2;

      const colors = {
        text: rgb(0.12, 0.14, 0.18),
        muted: rgb(0.40, 0.45, 0.52),
        line: rgb(0.87, 0.89, 0.92),
        panel: rgb(0.97, 0.97, 0.98),
        rowAlt: rgb(0.985, 0.985, 0.99),
        brand: rgb(0.09, 0.11, 0.15),
      };

      // logo
      let logoImg = null;
      try {
        const res = await fetch(logoUrl);
        const bytes = await res.arrayBuffer();
        logoImg = await pdfDoc.embedPng(bytes);
      } catch (e) {
        console.warn("Logo load failed (continuing without logo):", e);
      }

      let page = pdfDoc.addPage([pageWidth, pageHeight]);
      let y = pageHeight - margin;

      const ensureSpace = (needed) => {
        if (y - needed < margin) {
          page = pdfDoc.addPage([pageWidth, pageHeight]);
          y = pageHeight - margin;
          drawHeader(true);
        }
      };

      const drawText = (text, x, yPos, size = 11, bold = false, color = colors.text) => {
        page.drawText((text ?? "").toString(), {
          x,
          y: yPos,
          size,
          font: bold ? fontBold : font,
          color,
        });
      };

      const textWidth = (text, size = 11, bold = false) => {
        const f = bold ? fontBold : font;
        return f.widthOfTextAtSize((text ?? "").toString(), size);
      };

      const wrapLines = (text, size, bold, maxWidth) => {
        const f = bold ? fontBold : font;
        const words = (text ?? "").toString().split(/\s+/).filter(Boolean);
        const lines = [];
        let line = "";
        for (const w of words) {
          const cand = line ? `${line} ${w}` : w;
          if (f.widthOfTextAtSize(cand, size) <= maxWidth) line = cand;
          else {
            if (line) lines.push(line);
            line = w;
          }
        }
        if (line) lines.push(line);
        return lines;
      };

      const drawLine = (yPos) => {
        page.drawLine({
          start: { x: margin, y: yPos },
          end: { x: pageWidth - margin, y: yPos },
          thickness: 1,
          color: colors.line,
        });
      };

      const fmtDate = (d) => new Date(d || Date.now()).toLocaleDateString();

      const getRoomSummary = (roomId) => {
        const pricing = pricingMap?.[roomId] || {};
        const styleName = pricing.cabinet_style_id ? styleMap[pricing.cabinet_style_id] : "";
        const primaryFinishId = pricing.finish_type_id ?? pricing.primary_finish_id;
        const finishName = primaryFinishId ? finishMap[primaryFinishId] : "";
        return joinNonEmpty([styleName, finishName], " • ");
      };

      const drawHeader = (isContinued = false) => {
        const headerTop = pageHeight - margin;

        page.drawRectangle({
          x: margin,
          y: headerTop - 8,
          width: contentWidth,
          height: 2,
          color: colors.brand,
        });

        const logoBoxSize = 56;
        const logoX = margin;
        const logoY = headerTop - 70;

        if (logoImg) {
          const { width: iw, height: ih } = logoImg.scale(1);
          const scale = Math.min(logoBoxSize / iw, logoBoxSize / ih);
          const w = iw * scale;
          const h = ih * scale;
          page.drawImage(logoImg, {
            x: logoX,
            y: logoY + (logoBoxSize - h) / 2,
            width: w,
            height: h,
          });
        }

        const titleX = margin + (logoImg ? logoBoxSize + 14 : 0);
        const rightX = pageWidth - margin;

        const quoteNo = quote?.quote_number ? `Quote ${quote.quote_number}` : "Quote";
        const project = quote?.project_name || "";
        const address = quote?.site_address || "";
        const customer = quote?.customers?.name || "";
        const dateStr = fmtDate(quote?.created_at);
        const variantStr = `Variant: ${selectedVariantName || "Base"}`;

        drawText("Shelby Woodworking Cabinets", titleX, headerTop - 28, 14, true, colors.text);
        drawText(project, titleX, headerTop - 46, 11, false, colors.muted);
        if (address) drawText(address, titleX, headerTop - 60, 10, false, colors.muted);

        const rightBlockTop = headerTop - 28;
        const line1 = quoteNo + (isContinued ? " (continued)" : "");
        const line2 = `Date: ${dateStr}`;

        drawText(line1, rightX - textWidth(line1, 12, true), rightBlockTop, 12, true, colors.text);
        drawText(line2, rightX - textWidth(line2, 10, false), rightBlockTop - 16, 10, false, colors.muted);
        drawText(variantStr, rightX - textWidth(variantStr, 10, false), rightBlockTop - 30, 10, false, colors.muted);

        if (customer) {
          const line3 = `Customer: ${customer}`;
          drawText(line3, rightX - textWidth(line3, 10, false), rightBlockTop - 44, 10, false, colors.muted);
        }

        drawLine(headerTop - 82);
        y = headerTop - 98;
      };

      // Header
      drawHeader(false);

      // Title
      drawText("Estimate Summary", margin, y, 13, true, colors.text);
      y -= 18;
      drawText("Includes room totals and selected options.", margin, y, 10, false, colors.muted);
      y -= 16;

      // Table header
      ensureSpace(80);

      const tableX = margin;
      const tableW = contentWidth;
      const colRoomW = Math.floor(tableW * 0.58);
      const colTotalW = tableW - colRoomW;

      page.drawRectangle({
        x: tableX,
        y: y - 18,
        width: tableW,
        height: 22,
        color: colors.panel,
      });

      drawText("Room", tableX + 10, y - 4, 10, true, colors.muted);
      drawText("Total", tableX + colRoomW + 10, y - 4, 10, true, colors.muted);
      y -= 28;

      // Rows
      let rowIndex = 0;

      for (const r of rooms) {
        const pricing = pricingMap?.[r.id] || {};
        const subtotal = Number(pricing?.room_subtotal || 0);

        const name = r.name || "Room";
        const summary = getRoomSummary(r.id) || "—";
        const extrasLine = buildExtrasLine(r.id);

        const mixed =
          pricing?.has_mixed_finish && pricing?.secondary_finish_id
            ? `Mixed finish: ${finishMap[pricing.secondary_finish_id] || ""}`
            : "";

        const roomLines = [
          { text: name, size: 11, bold: true, color: colors.text },
          { text: summary, size: 10, bold: false, color: colors.muted },
          ...(mixed ? [{ text: mixed, size: 10, bold: false, color: colors.muted }] : []),
          ...(extrasLine ? [{ text: `Extras: ${extrasLine}`, size: 10, bold: false, color: colors.muted }] : []),
        ];

        const roomTextMaxW = colRoomW - 20;
        const wrappedCounts = roomLines.map((l) => wrapLines(l.text, l.size, l.bold, roomTextMaxW).length);
        const rowH = 14 + wrappedCounts.reduce((s, c) => s + c, 0) * 12 + 10;

        ensureSpace(rowH + 20);

        if (rowIndex % 2 === 1) {
          page.drawRectangle({
            x: tableX,
            y: y - rowH + 6,
            width: tableW,
            height: rowH,
            color: colors.rowAlt,
          });
        }

        let textY = y - 6;
        for (const l of roomLines) {
          const lines = wrapLines(l.text, l.size, l.bold, roomTextMaxW);
          for (const ln of lines) {
            drawText(ln, tableX + 10, textY, l.size, l.bold, l.color);
            textY -= 12;
          }
        }

        const totalStr = money(subtotal);
        const tw = textWidth(totalStr, 11, true);
        drawText(totalStr, tableX + colRoomW + colTotalW - 10 - tw, y - 6, 11, true, colors.text);

        drawLine(y - rowH + 6);

        y -= rowH;
        rowIndex += 1;
      }

      y -= 10;

      // Totals block
      ensureSpace(120);

      const boxW = 240;
      const boxX = pageWidth - margin - boxW;
      const boxY = y - 64;

      page.drawRectangle({
        x: boxX,
        y: boxY,
        width: boxW,
        height: 74,
        color: colors.panel,
        borderColor: colors.line,
        borderWidth: 1,
      });

      drawText("Total", boxX + 12, boxY + 48, 11, true, colors.muted);

      const totalStr = money(quoteTotal);
      const totW = textWidth(totalStr, 18, true);
      drawText(totalStr, boxX + boxW - 12 - totW, boxY + 22, 18, true, colors.text);

      y = boxY - 24;

      // Footer
      ensureSpace(80);
      drawLine(y);
      y -= 16;

      drawText("Thank you for the opportunity to quote your project.", margin, y, 10, false, colors.muted);
      y -= 14;

      drawText("Shelby Woodworking Cabinets • Jackson County, GA", margin, y, 9, false, colors.muted);
      y -= 12;
      drawText("Questions? Reply to this email or contact our office.", margin, y, 9, false, colors.muted);

      // Page numbers
      const pages = pdfDoc.getPages();
      for (let i = 0; i < pages.length; i++) {
        const p = pages[i];
        const label = `Page ${i + 1} of ${pages.length}`;
        const size = 9;
        const w = font.widthOfTextAtSize(label, size);
        p.drawText(label, {
          x: pageWidth - margin - w,
          y: 24,
          size,
          font,
          color: colors.muted,
        });
      }

      const pdfBytes = await pdfDoc.save();
      const blob = new Blob([pdfBytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      console.error(err);
      alert(err.message || "Failed to generate PDF");
    } finally {
      setBusy(false);
    }
  }

  const backToQuoteHref = `/quotes/${id}?room_variant_id=${selectedVariantId || ""}`;

  return (
    <Page
      title="Quote PDF"
      subtitle={quote ? `${quote.quote_number ?? ""} • ${quote.project_name ?? ""} • ${selectedVariantName || "Base"}` : ""}
      actions={
        <div className="flex items-center gap-2">
          <Link to={backToQuoteHref}>
            <Button variant="ghost">Back</Button>
          </Link>
          <Button onClick={buildPdf} disabled={loading || busy || !quote}>
            {busy ? "Building…" : "Open PDF"}
          </Button>
        </div>
      }
    >
      <Card>
        <CardHeader title="Preview" />
        <CardBody>
          {loading ? (
            <div className="text-sm text-slate-600">Loading quote data…</div>
          ) : (
            <div className="space-y-4">
              <div className="grid md:grid-cols-3 gap-3">
                <div className="rounded-xl border bg-white p-3">
                  <div className="text-xs text-slate-500">Customer</div>
                  <div className="font-medium">{quote?.customers?.name ?? "—"}</div>
                </div>
                <div className="rounded-xl border bg-white p-3">
                  <div className="text-xs text-slate-500">Project</div>
                  <div className="font-medium">{quote?.project_name ?? "—"}</div>
                  <div className="text-sm text-slate-500">{quote?.site_address ?? ""}</div>
                </div>
                <div className="rounded-xl border bg-white p-3">
                  <div className="text-xs text-slate-500">Variant</div>
                  <div className="font-medium">{selectedVariantName || "Base"}</div>
                  <div className="text-sm text-slate-500">{rooms.length} rooms</div>
                </div>
              </div>

              <div className="rounded-xl border bg-white p-3">
                <div className="text-xs text-slate-500">Total</div>
                <div className="text-xl font-bold tabular-nums">{money(quoteTotal)}</div>
              </div>

              {rooms.length === 0 ? (
                <div className="text-sm text-slate-600">No rooms found for this quote.</div>
              ) : (
                <div className="rounded-2xl border bg-white overflow-hidden">
                  <div className="px-4 py-3 border-b flex items-center justify-between">
                    <div className="font-semibold">Rooms</div>
                    <div className="text-sm text-slate-500">What the PDF will include</div>
                  </div>

                  <ul className="divide-y">
                    {rooms.map((r) => {
                      const pricing = pricingMap?.[r.id] || null;

                      const subtotal = Number(pricing?.room_subtotal || 0);
                      const hasSubtotal = !!pricing;

                      const styleName = pricing?.cabinet_style_id ? styleMap[pricing.cabinet_style_id] : "";
                      const primaryFinishId = pricing?.finish_type_id ?? pricing?.primary_finish_id;
                      const finishName = primaryFinishId ? finishMap[primaryFinishId] : "";
                      const secondaryFinishName = pricing?.secondary_finish_id ? finishMap[pricing.secondary_finish_id] : "";

                      const extrasLine = buildExtrasLine(r.id);

                      return (
                        <li key={r.id} className="px-4 py-3 flex items-start justify-between gap-6">
                          <div className="min-w-0">
                            <div className="font-medium truncate">{r.name}</div>

                            <div className="mt-1 text-sm text-slate-600 space-y-1">
                              {styleName || finishName ? (
                                <div>{joinNonEmpty([styleName, finishName], " • ")}</div>
                              ) : (
                                <div className="text-slate-500">No style/finish set yet</div>
                              )}

                              {pricing?.has_mixed_finish && secondaryFinishName ? (
                                <div className="text-slate-500">Mixed finish: {secondaryFinishName}</div>
                              ) : null}

                              {extrasLine ? (
                                <div className="text-slate-500">Extras: {extrasLine}</div>
                              ) : (
                                <div className="text-slate-400">Extras: none</div>
                              )}
                            </div>

                            <div className="mt-2">
                              {hasSubtotal ? <Pill tone="green">Ready</Pill> : <Pill tone="amber">Missing pricing</Pill>}
                            </div>
                          </div>

                          <div className="text-right shrink-0">
                            <div className="text-xs text-slate-500">Room Total</div>
                            <div className="font-semibold tabular-nums">{money(subtotal)}</div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>

                  <div className="px-4 py-4 border-t flex items-center justify-between">
                    <div className="text-lg font-semibold">Quote Total</div>
                    <div className="text-xl font-bold tabular-nums">{money(quoteTotal)}</div>
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                <Button onClick={buildPdf} disabled={busy || !quote}>
                  {busy ? "Building…" : "Open PDF"}
                </Button>
                <Link to={backToQuoteHref}>
                  <Button variant="secondary">Back to Quote</Button>
                </Link>
              </div>

              <div className="text-xs text-slate-500">
                PDF output includes room name, style, finish, extras names (qty if &gt; 1), room subtotal, and total.
                It does not include LF, rates, formulas, or tier logic.
              </div>
            </div>
          )}
        </CardBody>
      </Card>
    </Page>
  );
}
