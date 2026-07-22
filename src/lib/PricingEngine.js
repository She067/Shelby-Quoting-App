// src/lib/pricingEngine.js

/**
 * Pricing rules:
 * 1) Base LF subtotal = total_lf * primary_rate
 * 2) Mixed finish delta = (secondary_rate - primary_rate) * secondary_lf
 * 3) Percent extras apply to (LF subtotal + mixed delta)
 * 4) Fixed extras + appliance panels add after percent
 *
 * Percent values are stored as "10" for 10% (NOT 0.10).
 */

export function money(n) {
  const v = Number(n || 0);
  // keep internal precision, round only for display/storage totals
  return Math.round(v * 100) / 100;
}

export function calcRoomPricing({
  totalLf,
  primaryRate,
  mixed = null, // { secondaryLf, secondaryRate }
  percentExtras = [], // [{ value: 10 }, ...] where value is 10 meaning 10%
  fixedExtras = [], // [{ value: 200 }, ...]
  appliancePanelsTotal = 0, // fixed dollars (qty * price per panel)
}) {
  const lf = Number(totalLf || 0);
  const rate1 = Number(primaryRate || 0);

  const lfSubtotal = lf * rate1;

  let mixedDelta = 0;
  if (mixed && mixed.secondaryLf > 0) {
    const secLf = Number(mixed.secondaryLf || 0);
    const rate2 = Number(mixed.secondaryRate || 0);

    // clamp secondary LF so it can never exceed total LF
    const clampedSecLf = Math.max(0, Math.min(secLf, lf));
    mixedDelta = (rate2 - rate1) * clampedSecLf;
  }

  const baseSubtotal = lfSubtotal + mixedDelta;

  // Percent extras apply to baseSubtotal only
  const percentTotal = percentExtras.reduce((sum, e) => {
    const pct = Number(e?.value || 0) / 100; // 10 -> 0.10
    return sum + baseSubtotal * pct;
  }, 0);

  const fixedTotal = fixedExtras.reduce((sum, e) => {
    return sum + Number(e?.value || 0);
  }, 0);

  const panelsTotal = Number(appliancePanelsTotal || 0);

  const finalSubtotal = baseSubtotal + percentTotal + fixedTotal + panelsTotal;

  return {
    lfSubtotal: money(lfSubtotal),
    mixedDelta: money(mixedDelta),
    baseSubtotal: money(baseSubtotal),
    percentTotal: money(percentTotal),
    fixedTotal: money(fixedTotal),
    panelsTotal: money(panelsTotal),
    finalSubtotal: money(finalSubtotal),
  };
}
