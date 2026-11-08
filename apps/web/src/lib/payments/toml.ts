/** Stellar TOML fields required for SEP-24 / SEP-10. */

export interface AnchorCurrency {
  code: string;
  issuer?: string;
}

export interface AnchorToml {
  homeDomain: string;
  signingKey: string;
  webAuthEndpoint: string;
  transferServerSep24: string;
  networkPassphrase?: string;
  currencies: AnchorCurrency[];
}

export class TomlParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TomlParseError";
  }
}

function quoted(value: string): string {
  return value.replace(/^["']|["']$/g, "").trim();
}

function stringField(body: string, key: string): string | undefined {
  const match = body.match(new RegExp(`^\\s*${key}\\s*=\\s*(.+)$`, "im"));
  if (!match) return undefined;
  return quoted(match[1].replace(/\s+#.*$/, ""));
}

function parseCurrencies(body: string): AnchorCurrency[] {
  const currencies: AnchorCurrency[] = [];
  const blocks = body.split(/\[\[CURRENCIES\]\]/i).slice(1);
  for (const block of blocks) {
    const section = block.split(/\n\[/)[0];
    const code = stringField(section, "code");
    if (!code) continue;
    currencies.push({ code, issuer: stringField(section, "issuer") });
  }
  return currencies;
}

/** Parse the subset of stellar.toml needed for SEP-10 and SEP-24. */
export function parseStellarToml(homeDomain: string, body: string): AnchorToml {
  const signingKey = stringField(body, "SIGNING_KEY");
  const webAuthEndpoint = stringField(body, "WEB_AUTH_ENDPOINT");
  const transferServerSep24 =
    stringField(body, "TRANSFER_SERVER_SEP0024") ?? stringField(body, "TRANSFER_SERVER");
  if (!signingKey || !/^G[A-Z2-7]{55}$/.test(signingKey)) {
    throw new TomlParseError("stellar.toml is missing a valid SIGNING_KEY");
  }
  if (!webAuthEndpoint) {
    throw new TomlParseError("stellar.toml is missing WEB_AUTH_ENDPOINT");
  }
  if (!transferServerSep24) {
    throw new TomlParseError("stellar.toml is missing TRANSFER_SERVER_SEP0024");
  }
  return {
    homeDomain: homeDomain.replace(/^https?:\/\//, "").replace(/\/$/, ""),
    signingKey,
    webAuthEndpoint: webAuthEndpoint.replace(/\/$/, ""),
    transferServerSep24: transferServerSep24.replace(/\/$/, ""),
    networkPassphrase: stringField(body, "NETWORK_PASSPHRASE"),
    currencies: parseCurrencies(body),
  };
}

export async function fetchStellarToml(
  homeDomain: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AnchorToml> {
  const host = homeDomain.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const url = `https://${host}/.well-known/stellar.toml`;
  const response = await fetchImpl(url, { headers: { Accept: "text/plain" }, cache: "no-store" });
  if (!response.ok) {
    throw new TomlParseError(`Could not load stellar.toml from ${host} (${response.status})`);
  }
  return parseStellarToml(host, await response.text());
}
