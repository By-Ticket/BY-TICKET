/** Convert 7-decimal token units to a SEP-24 amount string. */
export function unitsToAmountString(units: bigint, decimals = 7): string {
  const neg = units < 0n;
  const abs = neg ? -units : units;
  const scale = 10n ** BigInt(decimals);
  const whole = abs / scale;
  const frac = (abs % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole.toString()}${frac ? `.${frac}` : ""}`;
}
