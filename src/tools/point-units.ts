/** Validate caller coordinates before emitting a host command. */
export function pointUnitsError(units: unknown, x: unknown, y: unknown, partial = false): string | null {
  if (units !== undefined && units !== "pixels" && units !== "normalized") return "units must be pixels or normalized.";
  if (partial && x === undefined && y === undefined) return units === undefined ? null : "units requires a position value.";
  for (const value of [x, y]) {
    if (partial && value === undefined) continue;
    if (typeof value !== "number" || !Number.isFinite(value)) return "Position coordinates must be finite numbers.";
    if (units === "normalized" && (value < 0 || value > 1)) return "Normalized coordinates must be between 0 and 1.";
  }
  return null;
}
