import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

function dist(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function scalePoint(pt, factor) {
  return { x: pt.x * factor, y: pt.y * factor };
}

/**
 * Non-blocking right-side drawer:
 * - Backdrop is visual only (click-through)
 * - Only the drawer panel captures clicks
 *
 * Zoom-consistent calibration:
 * - Store calibration as feet-per-pixel at 1.0x zoom (feetPerPixelAt1x)
 * - Use currentFeetPerPixel = feetPerPixelAt1x / renderScale
 * - Rescale stored points when zoom changes so drawings stay aligned
 */
export default function PlanMeasureDrawer({
  open,
  onClose,
  pdfUrl,
  initialScaleFpp, // treated as FEET PER PIXEL at 1.0x
  initialScalePage,
  pageCount,
  onSaveScale,
  onDetectedPageCount,
  leftPanelTop = null,
  title = "Plan View",
}) {
  const canvasRef = useRef(null);
  const overlayRef = useRef(null);

  // keep latest callbacks without putting them in deps (prevents weird loops)
  const onSaveScaleRef = useRef(onSaveScale);
  const onDetectedPageCountRef = useRef(onDetectedPageCount);
  useEffect(() => {
    onSaveScaleRef.current = onSaveScale;
  }, [onSaveScale]);
  useEffect(() => {
    onDetectedPageCountRef.current = onDetectedPageCount;
  }, [onDetectedPageCount]);

  const [pdfDoc, setPdfDoc] = useState(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState("");

  const [pageNum, setPageNum] = useState(1);
  const [renderScale, setRenderScale] = useState(1.6);

  // scale
  const [mode, setMode] = useState("measure"); // "calibrate" | "measure"
  const [knownFeet, setKnownFeet] = useState(10);
  const [calPts, setCalPts] = useState([]);

  // ✅ store as feet-per-pixel at 1.0x zoom (zoom independent)
  const [feetPerPixelAt1x, setFeetPerPixelAt1x] = useState(null);

  // measure
  const [path, setPath] = useState([]);
  const [hoverPt, setHoverPt] = useState(null);
  const [segments, setSegments] = useState([]); // {id, feet, points}

  const totalFeet = useMemo(
    () => segments.reduce((sum, s) => sum + Number(s.feet || 0), 0),
    [segments]
  );

  const currentFeetPerPixel = useMemo(() => {
    const base = feetPerPixelAt1x !== null && feetPerPixelAt1x !== undefined ? Number(feetPerPixelAt1x) : null;
    if (!base || !isFinite(base) || base <= 0) return null;
    const s = Number(renderScale || 1);
    if (!isFinite(s) || s <= 0) return null;
    return base / s;
  }, [feetPerPixelAt1x, renderScale]);

  const prevRenderScaleRef = useRef(renderScale);

  // initialize when opening / changing doc
  useEffect(() => {
    if (!open) return;

    const fpp1 =
      initialScaleFpp !== null && initialScaleFpp !== undefined
        ? Number(initialScaleFpp)
        : null;

    const startPage =
      initialScalePage !== null && initialScalePage !== undefined
        ? Number(initialScalePage)
        : 1;

    setFeetPerPixelAt1x(fpp1);
    setPageNum(startPage || 1);
    setCalPts([]);
    setKnownFeet(10);
    setMode(fpp1 ? "measure" : "calibrate");
    setPath([]);
    setHoverPt(null);
    setSegments([]);
    setPdfError("");

    prevRenderScaleRef.current = renderScale;
  }, [open, pdfUrl, initialScaleFpp, initialScalePage, renderScale]);

  // ✅ rescale stored points when zoom changes so drawings stay aligned
  useEffect(() => {
    if (!open) return;

    const prev = prevRenderScaleRef.current;
    const next = renderScale;
    if (!prev || prev === next) return;

    const factor = next / prev;

    setCalPts((pts) => pts.map((p) => scalePoint(p, factor)));
    setPath((pts) => pts.map((p) => scalePoint(p, factor)));
    setSegments((prevSegs) =>
      prevSegs.map((seg) => ({
        ...seg,
        points: (seg.points || []).map((p) => scalePoint(p, factor)),
      }))
    );

    prevRenderScaleRef.current = next;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderScale, open]);

  // load PDF (binary) only when open
  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!open) return;
      if (!pdfUrl) {
        setPdfDoc(null);
        return;
      }

      try {
        setPdfLoading(true);
        setPdfError("");

        const res = await fetch(pdfUrl);
        if (!res.ok) throw new Error(`Failed to fetch PDF (${res.status})`);

        const ab = await res.arrayBuffer();
        const doc = await pdfjsLib.getDocument({ data: ab }).promise;
        if (cancelled) return;

        setPdfDoc(doc);

        // Tell parent actual page count (optional)
        const numPages = doc?.numPages || 1;
        const cb = onDetectedPageCountRef.current;
        if (typeof cb === "function") {
          try {
            await cb(numPages);
          } catch (e) {
            console.warn("onDetectedPageCount failed:", e);
          }
        }

        setPageNum((p) => clamp(p, 1, numPages));
      } catch (e) {
        console.error("PDF load error:", e);
        if (!cancelled) {
          setPdfDoc(null);
          setPdfError(e?.message || "PDF failed to load.");
        }
      } finally {
        if (!cancelled) setPdfLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, pdfUrl]);

  // render PDF page
  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!open) return;
      if (!pdfDoc) return;

      const maxPages = pdfDoc.numPages || 1;
      const safePage = clamp(pageNum, 1, maxPages);
      if (safePage !== pageNum) setPageNum(safePage);

      const page = await pdfDoc.getPage(safePage);
      if (cancelled) return;

      const viewport = page.getViewport({ scale: renderScale });

      const canvas = canvasRef.current;
      const overlay = overlayRef.current;
      if (!canvas || !overlay) return;

      const ctx = canvas.getContext("2d");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);

      overlay.width = canvas.width;
      overlay.height = canvas.height;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;

      if (!cancelled) redrawOverlay();
    })().catch((e) => console.error("PDF render error:", e));

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pdfDoc, pageNum, renderScale]);

  function getCanvasPoint(evt) {
    const overlay = overlayRef.current;
    const rect = overlay.getBoundingClientRect();
    const x = (evt.clientX - rect.left) * (overlay.width / rect.width);
    const y = (evt.clientY - rect.top) * (overlay.height / rect.height);
    return { x, y };
  }

  function redrawOverlay() {
    const overlay = overlayRef.current;
    if (!overlay) return;
    const ctx = overlay.getContext("2d");

    ctx.clearRect(0, 0, overlay.width, overlay.height);

    // calibration guide
    if (calPts.length) {
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(0,140,255,0.9)";
      ctx.fillStyle = "rgba(0,140,255,0.9)";
      calPts.forEach((p) => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
        ctx.fill();
      });

      if (calPts.length === 2) {
        ctx.beginPath();
        ctx.moveTo(calPts[0].x, calPts[0].y);
        ctx.lineTo(calPts[1].x, calPts[1].y);
        ctx.stroke();
      }
    }

    // finished segments
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(0,200,120,0.85)";
    segments.forEach((seg) => {
      const pts = seg.points || [];
      if (pts.length < 2) return;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
    });

    // active path
    if (path.length) {
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(255,180,0,0.95)";
      ctx.fillStyle = "rgba(255,180,0,0.95)";
      ctx.beginPath();
      ctx.moveTo(path[0].x, path[0].y);
      for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y);

      if (hoverPt) ctx.lineTo(hoverPt.x, hoverPt.y);

      ctx.stroke();

      path.forEach((p) => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  }

  useEffect(() => {
    if (!open) return;
    redrawOverlay();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, calPts, path, hoverPt, segments]);

  function handleClick(evt) {
    const pt = getCanvasPoint(evt);

    if (mode === "calibrate") {
      setCalPts((prev) => {
        if (prev.length >= 2) return [pt];
        return [...prev, pt];
      });
      return;
    }

    if (!currentFeetPerPixel) {
      alert("Scale not set. Calibrate first.");
      setMode("calibrate");
      return;
    }

    setPath((prev) => [...prev, pt]);
  }

  function handleMouseMove(evt) {
    if (mode !== "measure") return;
    if (!path.length) return;
    setHoverPt(getCanvasPoint(evt));
  }

  function cancelCurrentPath() {
    setPath([]);
    setHoverPt(null);
  }

  function undoPoint() {
    setPath((prev) => prev.slice(0, -1));
  }

  function finishSegment() {
    if (mode !== "measure") return;
    if (!currentFeetPerPixel) return;
    if (path.length < 2) return;

    let px = 0;
    for (let i = 1; i < path.length; i++) px += dist(path[i - 1], path[i]);

    const feet = px * currentFeetPerPixel;

    setSegments((prev) => [...prev, { id: crypto.randomUUID(), points: path, feet }]);
    cancelCurrentPath();
  }

  async function applyCalibration() {
    if (calPts.length !== 2) {
      alert("Click two points on a known dimension.");
      return;
    }

    const px = dist(calPts[0], calPts[1]);
    if (!px || px <= 0) return;

    const known = Number(knownFeet || 0);
    if (!isFinite(known) || known <= 0) {
      alert("Known feet must be > 0.");
      return;
    }

    // fpp at CURRENT zoom
    const fppAtCurrentZoom = known / px;

    // ✅ normalize to 1.0x so it stays consistent across zoom + sessions
    const fppAt1x = fppAtCurrentZoom * Number(renderScale || 1);

    if (!isFinite(fppAt1x) || fppAt1x <= 0) {
      alert("Calibration failed (invalid scale).");
      return;
    }

    setFeetPerPixelAt1x(fppAt1x);

    const cb = onSaveScaleRef.current;
    if (typeof cb === "function") {
      await cb({
        scaleFeetPerPixel: fppAt1x, // ✅ store normalized value
        scalePageNumber: pageNum,
      });
    }

    setMode("measure");
  }

  // keyboard shortcuts
  useEffect(() => {
    if (!open) return;

    function onKeyDown(e) {
      if (e.key === "Escape") cancelCurrentPath();

      if (e.key === "Backspace") {
        e.preventDefault();
        undoPoint();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const maxPages = pdfDoc?.numPages || pageCount || 1;

  return createPortal(
    <>
      {/* Visual-only backdrop (click-through) */}
      <div
        className="fixed inset-0 bg-black/20"
        style={{ zIndex: 2147483646, pointerEvents: "none" }}
      />

      {/* Drawer shell (click-through) */}
      <div className="fixed inset-0" style={{ zIndex: 2147483647, pointerEvents: "none" }}>
        {/* The drawer panel itself captures interaction */}
        <div
          className="absolute right-0 top-0 h-full w-[1300px] max-w-[95vw] bg-white border-l shadow-2xl flex flex-col"
          style={{ pointerEvents: "auto" }}
        >
          {/* Header */}
          <div className="p-4 border-b bg-white">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm text-slate-500">Plan</div>
                <div className="font-semibold truncate">{title}</div>
              </div>

              <button
                className="rounded-md border px-3 py-1.5 text-sm hover:bg-slate-50"
                onClick={onClose}
              >
                Close
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-hidden">
            <div className="h-full grid grid-cols-[340px_1fr]">
              {/* LEFT panel */}
              <div className="h-full border-r bg-white overflow-auto p-4 space-y-4">
                {leftPanelTop}

                <div className="rounded-lg border bg-slate-50 p-3">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-medium text-slate-800">Scale</div>
                    <div className="text-xs">
                      {feetPerPixelAt1x ? (
                        <span className="rounded bg-green-100 px-2 py-1 text-green-800 border border-green-200">
                          Ready
                        </span>
                      ) : (
                        <span className="rounded bg-amber-100 px-2 py-1 text-amber-800 border border-amber-200">
                          Not set
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="mt-2 flex items-center gap-2">
                    <button
                      className={`rounded-md border px-3 py-1.5 text-sm ${
                        mode === "calibrate" ? "bg-blue-50 border-blue-200" : "bg-white"
                      }`}
                      onClick={() => setMode("calibrate")}
                    >
                      Calibrate
                    </button>
                    <button
                      className={`rounded-md border px-3 py-1.5 text-sm ${
                        mode === "measure" ? "bg-green-50 border-green-200" : "bg-white"
                      }`}
                      onClick={() => setMode("measure")}
                      disabled={!feetPerPixelAt1x}
                      title={!feetPerPixelAt1x ? "Set scale first" : ""}
                    >
                      Measure
                    </button>
                  </div>

                  {mode === "calibrate" && (
                    <div className="mt-3 space-y-2">
                      <div className="text-xs text-slate-600">
                        Click 2 points on a known dimension, type the real feet, then “Set Scale”.
                      </div>

                      <div className="flex items-center gap-2">
                        <label className="text-xs text-slate-600 w-28">Known feet</label>
                        <input
                          className="w-full rounded-md border px-2 py-1.5 text-sm"
                          type="number"
                          step="0.01"
                          value={knownFeet}
                          onChange={(e) => setKnownFeet(e.target.value)}
                        />
                      </div>

                      <button
                        className="w-full rounded-md bg-blue-600 text-white px-3 py-2 text-sm disabled:opacity-50"
                        onClick={applyCalibration}
                        disabled={calPts.length !== 2}
                      >
                        Set Scale
                      </button>
                    </div>
                  )}

                  {mode === "measure" && (
                    <div className="mt-3 text-xs text-slate-600 space-y-1">
                      <div>Left click: add point</div>
                      <div>Right click: finish segment</div>
                      <div>Backspace: undo point</div>
                      <div>Esc: cancel current path</div>
                    </div>
                  )}
                </div>

                <div className="rounded-lg border p-3">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-medium text-slate-800">Measured</div>
                    <button
                      className="rounded-md border px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-50"
                      onClick={() => setSegments([])}
                      disabled={!segments.length}
                    >
                      Clear
                    </button>
                  </div>

                  <div className="mt-2">
  <div className="text-sm text-slate-500">Total (all segments)</div>
  <div className="text-3xl font-bold tabular-nums">
    {Number(totalFeet || 0).toFixed(2)}
  </div>
  <div className="text-xs text-slate-500">Linear Feet</div>
</div>

                  <div className="mt-3 space-y-2">
                    {segments.length === 0 ? (
                      <div className="text-sm text-slate-600">No segments yet.</div>
                    ) : (
                      segments.map((s, idx) => (
                        <div
                          key={s.id}
                          className="flex items-center justify-between gap-2 rounded-md border bg-white px-3 py-2"
                        >
                          <div className="text-sm">
                            Seg {idx + 1}:{" "}
                            <span className="font-semibold tabular-nums">
                              {Number(s.feet || 0).toFixed(2)}
                            </span>
                          </div>
                          <button
                            className="rounded-md border px-2 py-1 text-xs hover:bg-slate-50"
                            onClick={() => setSegments((prev) => prev.filter((x) => x.id !== s.id))}
                          >
                            Remove
                          </button>
                        </div>
                      ))
                    )}
                  </div>

                  <div className="mt-3 flex items-center gap-2">
                    <button
                      className="w-full rounded-md border px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
                      onClick={finishSegment}
                      disabled={mode !== "measure" || path.length < 2 || !currentFeetPerPixel}
                      title="Right click also finishes"
                    >
                      Finish Segment
                    </button>
                  </div>
                </div>
              </div>

              {/* RIGHT plan viewer */}
              <div className="relative bg-slate-100 overflow-hidden">
                <div className="absolute inset-0 overflow-auto p-4">
                  {/* Sticky toolbar */}
                  <div className="sticky top-2 z-20 mb-3 inline-flex flex-wrap items-center gap-2 rounded-xl border bg-white/95 px-3 py-2 shadow">
                    <button
                      className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
                      disabled={!pdfDoc || pageNum <= 1}
                      onClick={() => setPageNum((p) => Math.max(1, p - 1))}
                    >
                      ←
                    </button>

                    <div className="text-sm">
                      Page <span className="font-semibold">{pageNum}</span> / {maxPages}
                    </div>

                    <button
                      className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
                      disabled={!pdfDoc || pageNum >= maxPages}
                      onClick={() => setPageNum((p) => Math.min(maxPages, p + 1))}
                    >
                      →
                    </button>

                    <div className="ml-2 flex items-center gap-2">
                      <span className="text-sm text-slate-600">Zoom</span>
                      <input
                        type="range"
                        min="1"
                        max="3"
                        step="0.1"
                        value={renderScale}
                        onChange={(e) => setRenderScale(Number(e.target.value))}
                      />
                      <span className="text-sm tabular-nums">{renderScale.toFixed(1)}x</span>
                    </div>
                  </div>

                  {pdfLoading ? (
                    <div className="rounded-xl border bg-white p-6 text-slate-700">Loading PDF…</div>
                  ) : pdfError ? (
                    <div className="rounded-xl border bg-white p-6 text-red-700">{pdfError}</div>
                  ) : !pdfUrl ? (
                    <div className="rounded-xl border bg-white p-6 text-slate-700">No PDF loaded.</div>
                  ) : (
                    <div className="inline-block relative rounded-xl border bg-white shadow">
                      <canvas ref={canvasRef} className="block" />
                      <canvas
                        ref={overlayRef}
                        className="absolute left-0 top-0 cursor-crosshair"
                        onClick={handleClick}
                        onMouseMove={handleMouseMove}
                        onMouseLeave={() => setHoverPt(null)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          finishSegment();
                        }}
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Footer hint */}
          <div className="border-t bg-white px-4 py-2 text-xs text-slate-500">
            Tip: You can keep working in the Room Editor while this drawer is open.
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}