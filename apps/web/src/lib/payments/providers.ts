/** Future mobile-money rails. SEP-24 is the live on/off-ramp; these stay as metadata. */

export const MOBILE_MONEY_PROVIDERS = [
  { id: "mtn_momo", name: "MTN MoMo", country: "ZM" },
  { id: "airtel_money", name: "Airtel Money", country: "ZM" },
  { id: "zamtel_kwacha", name: "Zamtel Kwacha", country: "ZM" },
] as const;

export type MobileMoneyProviderId = (typeof MOBILE_MONEY_PROVIDERS)[number]["id"];
