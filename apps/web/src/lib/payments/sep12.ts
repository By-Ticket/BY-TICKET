import type { AnchorToml } from "./toml";
import { mapSep12Status, type KycField, type KycStatus, type Sep12Status } from "./kyc-status";

export class Sep12Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Sep12Error";
  }
}

export interface Sep12FieldSpec {
  type?: string;
  description?: string;
  optional?: boolean;
  choices?: string[];
  status?: string;
}

export interface Sep12Customer {
  id?: string;
  status: Sep12Status;
  fields?: Record<string, Sep12FieldSpec>;
  provided_fields?: Record<string, Sep12FieldSpec>;
  message?: string;
}

function authHeaders(jwt: string, contentType?: string): HeadersInit {
  const headers: Record<string, string> = { Authorization: `Bearer ${jwt}` };
  if (contentType) headers["Content-Type"] = contentType;
  return headers;
}

export function fieldsFromCustomer(customer: Sep12Customer): KycField[] {
  const entries = Object.entries(customer.fields ?? {});
  return entries.map(([name, spec]) => ({
    name,
    type: spec.type === "binary" || spec.type === "number" || spec.type === "date" ? spec.type : "string",
    description: spec.description ?? name.replaceAll("_", " "),
    optional: spec.optional,
    choices: spec.choices,
  }));
}

export function customerToRecord(customer: Sep12Customer): { status: KycStatus; fields: KycField[]; id?: string; message?: string } {
  return {
    id: customer.id,
    status: mapSep12Status(customer.status),
    fields: fieldsFromCustomer(customer),
    message: customer.message,
  };
}

export class Sep12Client {
  constructor(
    private readonly toml: AnchorToml,
    private readonly jwt: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async getCustomer(account: string, type = "sep24"): Promise<Sep12Customer> {
    const url = new URL(`${this.toml.kycServer}/customer`);
    url.searchParams.set("account", account);
    url.searchParams.set("type", type);
    const response = await this.fetchImpl(url, { headers: authHeaders(this.jwt), cache: "no-store" });
    if (response.status === 404) {
      return { status: "NEEDS_INFO" };
    }
    if (!response.ok) {
      throw new Sep12Error(`Could not load KYC status (${response.status}).`);
    }
    const body = (await response.json()) as Sep12Customer;
    if (!body.status) throw new Sep12Error("The anchor did not return a KYC status.");
    return body;
  }

  async putCustomer(fields: Record<string, string | Blob>, extra?: { account?: string; type?: string }): Promise<{ id?: string }> {
    const hasBinary = Object.values(fields).some((value) => typeof value !== "string");
    let body: BodyInit;
    let contentType: string | undefined;
    if (hasBinary) {
      const form = new FormData();
      if (extra?.account) form.set("account", extra.account);
      if (extra?.type) form.set("type", extra.type);
      for (const [key, value] of Object.entries(fields)) {
        if (typeof value === "string") form.set(key, value);
        else form.set(key, value);
      }
      body = form;
    } else {
      const params = new URLSearchParams();
      if (extra?.account) params.set("account", extra.account);
      if (extra?.type) params.set("type", extra.type);
      for (const [key, value] of Object.entries(fields)) params.set(key, String(value));
      body = params;
      contentType = "application/x-www-form-urlencoded";
    }
    const response = await this.fetchImpl(`${this.toml.kycServer}/customer`, {
      method: "PUT",
      headers: authHeaders(this.jwt, contentType),
      body,
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Sep12Error(`The anchor rejected the KYC details (${response.status}): ${text.slice(0, 200)}`);
    }
    return (await response.json()) as { id?: string };
  }

  async deleteCustomer(account: string): Promise<void> {
    const url = new URL(`${this.toml.kycServer}/customer`);
    url.searchParams.set("account", account);
    const response = await this.fetchImpl(url, {
      method: "DELETE",
      headers: authHeaders(this.jwt),
    });
    if (!response.ok && response.status !== 404) {
      throw new Sep12Error(`Could not delete KYC data (${response.status}).`);
    }
  }

  /** Best-effort; anchors that do not support callbacks return 404. */
  async registerCallback(url: string, extra?: { id?: string; account?: string }): Promise<boolean> {
    const params = new URLSearchParams({ url });
    if (extra?.id) params.set("id", extra.id);
    if (extra?.account) params.set("account", extra.account);
    const response = await this.fetchImpl(`${this.toml.kycServer}/customer/callback`, {
      method: "PUT",
      headers: authHeaders(this.jwt, "application/x-www-form-urlencoded"),
      body: params,
    });
    return response.ok;
  }
}
