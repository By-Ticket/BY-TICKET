export type Sep12Status = "ACCEPTED" | "PROCESSING" | "NEEDS_INFO" | "REJECTED";
export type KycStatus = "accepted" | "processing" | "needs_info" | "rejected";

export interface KycField {
  name: string;
  type: "string" | "binary" | "number" | "date";
  description: string;
  optional?: boolean;
  choices?: string[];
}

export type KycGate =
  | { action: "allow"; status: KycStatus }
  | { action: "form"; status: "needs_info"; fields: KycField[]; message: string }
  | { action: "pending"; status: "processing"; message: string }
  | { action: "block"; status: "rejected"; message: string };

export function parseStoredKycFields(value: unknown): KycField[] {
  if (!Array.isArray(value)) return [];
  const fields: KycField[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item) || !("name" in item)) continue;
    const rec = item as { name: unknown; type?: unknown; description?: unknown; optional?: unknown; choices?: unknown };
    if (typeof rec.name !== "string") continue;
    const type = rec.type === "binary" || rec.type === "number" || rec.type === "date" ? rec.type : "string";
    fields.push({
      name: rec.name,
      type,
      description: typeof rec.description === "string" ? rec.description : rec.name.replaceAll("_", " "),
      optional: rec.optional === true,
      choices: Array.isArray(rec.choices) ? rec.choices.filter((choice): choice is string => typeof choice === "string") : undefined,
    });
  }
  return fields;
}

export function mapSep12Status(status: string): KycStatus {
  switch (status.toUpperCase()) {
    case "ACCEPTED":
      return "accepted";
    case "PROCESSING":
      return "processing";
    case "NEEDS_INFO":
      return "needs_info";
    case "REJECTED":
      return "rejected";
    default:
      return "needs_info";
  }
}

export function kycStatusMessage(status: KycStatus): string {
  switch (status) {
    case "accepted":
      return "Identity verification is complete.";
    case "processing":
      return "The anchor is still reviewing your details.";
    case "needs_info":
      return "The anchor needs a few details before this transfer.";
    case "rejected":
      return "The anchor could not verify this account, so this transfer is blocked.";
  }
}

/**
 * Fan deposits may skip KYC below `thresholdUsdc` when the status is not rejected.
 * Organizer cash-out always requires ACCEPTED.
 */
export function evaluateKycGate(input: {
  kind: "deposit" | "withdraw";
  status: KycStatus;
  fields: KycField[];
  amountUsdc: number;
  thresholdUsdc: number;
  message?: string;
}): KycGate {
  if (input.status === "rejected") {
    return { action: "block", status: "rejected", message: input.message || kycStatusMessage("rejected") };
  }
  if (input.kind === "withdraw") {
    if (input.status === "accepted") return { action: "allow", status: "accepted" };
    if (input.status === "processing") {
      return { action: "pending", status: "processing", message: input.message || kycStatusMessage("processing") };
    }
    return {
      action: "form",
      status: "needs_info",
      fields: input.fields,
      message: input.message || "Verify your identity before cashing out.",
    };
  }
  if (input.status === "accepted") return { action: "allow", status: "accepted" };
  if (input.thresholdUsdc > 0 && input.amountUsdc < input.thresholdUsdc) {
    return { action: "allow", status: input.status };
  }
  if (input.status === "processing") {
    return { action: "pending", status: "processing", message: input.message || kycStatusMessage("processing") };
  }
  return {
    action: "form",
    status: "needs_info",
    fields: input.fields,
    message: input.message || kycStatusMessage("needs_info"),
  };
}
