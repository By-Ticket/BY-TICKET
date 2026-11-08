import { describe, expect, it, vi } from "vitest";
import { Sep12Client, fieldsFromCustomer } from "./sep12";
import type { AnchorToml } from "./toml";

const toml: AnchorToml = {
  homeDomain: "testanchor.stellar.org",
  signingKey: "GCHLHDBOKG2JWMJQBTLSL5XG6NO7ESXI2TAQKZXCXWXB5WI2X6W233PR",
  webAuthEndpoint: "https://testanchor.stellar.org/auth",
  transferServerSep24: "https://testanchor.stellar.org/sep24",
  kycServer: "https://testanchor.stellar.org/sep12",
  currencies: [],
};

describe("SEP-12 client (mocked fetch)", () => {
  it("gets customer status and required fields", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toContain("/customer?");
      return Response.json({
        status: "NEEDS_INFO",
        fields: { first_name: { type: "string", description: "First name" } },
      });
    }) as unknown as typeof fetch;
    const client = new Sep12Client(toml, "jwt", fetchImpl);
    const customer = await client.getCustomer("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    expect(customer.status).toBe("NEEDS_INFO");
    expect(fieldsFromCustomer(customer)[0]?.name).toBe("first_name");
  });

  it("puts string fields as form-urlencoded", async () => {
    let posted = "";
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      posted = String(init?.body);
      expect(init?.method).toBe("PUT");
      expect(String(input)).toContain("/customer");
      return Response.json({ id: "cust_1" });
    }) as unknown as typeof fetch;
    const client = new Sep12Client(toml, "jwt", fetchImpl);
    await client.putCustomer({ first_name: "Ada" }, { account: "GAAA", type: "sep24" });
    expect(posted).toContain("first_name=Ada");
  });

  it("puts file uploads as multipart FormData", async () => {
    let usedForm = false;
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      usedForm = typeof FormData !== "undefined" && init?.body instanceof FormData;
      expect(init?.method).toBe("PUT");
      return Response.json({ id: "cust_2" });
    }) as unknown as typeof fetch;
    const client = new Sep12Client(toml, "jwt", fetchImpl);
    await client.putCustomer({ photo_id_front: new Blob(["id"], { type: "image/png" }) }, { account: "GAAA" });
    expect(usedForm).toBe(true);
  });

  it("treats GET 404 as NEEDS_INFO", async () => {
    const fetchImpl = vi.fn(async () => new Response("not found", { status: 404 })) as unknown as typeof fetch;
    const client = new Sep12Client(toml, "jwt", fetchImpl);
    await expect(client.getCustomer("GAAA")).resolves.toEqual({ status: "NEEDS_INFO" });
  });

  it("deletes the customer and registers a callback", async () => {
    const methods: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      methods.push(`${init?.method ?? "GET"} ${String(input)}`);
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const client = new Sep12Client(toml, "jwt", fetchImpl);
    await client.deleteCustomer("GAAA");
    await client.registerCallback("https://by-ticket.example/api/ramp/callbacks");
    expect(methods[0]).toMatch(/^DELETE .*\/customer\?account=GAAA/);
    expect(methods[1]).toMatch(/^PUT .*\/customer\/callback/);
  });
});
