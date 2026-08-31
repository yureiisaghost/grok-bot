import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type {
  OAuthClientMetadata,
  OAuthClientProvider,
  OAuthDiscoveryState,
  StoredOAuthTokens,
} from "@modelcontextprotocol/client"

const STORE_DIR = path.join(os.homedir(), ".grok-trading")
const STORE_FILE = path.join(STORE_DIR, "rh-mcp-oauth.json")
export const MCP_URL = "https://agent.robinhood.com/mcp/trading"
export const REDIRECT_URL = "http://127.0.0.1:5174/api/mcp/callback"

interface StoreFile {
  clientByIssuer: Record<string, unknown>
  tokensByIssuer: Record<string, StoredOAuthTokens>
  lastTokens?: StoredOAuthTokens
  verifier?: string
  lastState?: string
  discovery?: OAuthDiscoveryState
  pendingAuthUrl?: string
}

function emptyStore(): StoreFile {
  return { clientByIssuer: {}, tokensByIssuer: {} }
}

function readStore(): StoreFile {
  try {
    if (!fs.existsSync(STORE_FILE)) return emptyStore()
    return { ...emptyStore(), ...JSON.parse(fs.readFileSync(STORE_FILE, "utf8")) as StoreFile }
  } catch {
    return emptyStore()
  }
}

function writeStore(store: StoreFile) {
  fs.mkdirSync(STORE_DIR, { recursive: true })
  fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), "utf8")
}

export class FileOAuthProvider implements OAuthClientProvider {
  private store: StoreFile

  constructor() {
    this.store = readStore()
  }

  reload() {
    this.store = readStore()
  }

  get redirectUrl() {
    return REDIRECT_URL
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "Trade Desk",
      redirect_uris: [REDIRECT_URL],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      application_type: "native",
      scope: "internal",
    }
  }

  private persist() {
    writeStore(this.store)
  }

  state() {
    this.reload()
    if (this.store.lastState && (this.store.verifier || this.store.pendingAuthUrl) && !this.store.lastTokens) {
      return this.store.lastState
    }
    this.store.lastState = crypto.randomUUID()
    this.persist()
    return this.store.lastState
  }

  get lastState() {
    return this.store.lastState
  }

  get pendingAuthUrl() {
    return this.store.pendingAuthUrl
  }

  hasTokens() {
    return Boolean(this.store.lastTokens?.access_token)
  }

  expectedState() {
    const fromUrl = this.store.pendingAuthUrl
      ? new URL(this.store.pendingAuthUrl).searchParams.get("state")
      : null
    return fromUrl || this.store.lastState || null
  }

  clearPendingFlow() {
    this.store.verifier = undefined
    this.store.lastState = undefined
    this.store.pendingAuthUrl = undefined
    this.persist()
  }

  clientInformation(ctx?: { issuer?: string }) {
    if (ctx?.issuer) return this.store.clientByIssuer[ctx.issuer] as never
    const first = Object.values(this.store.clientByIssuer)[0]
    return first as never
  }

  saveClientInformation(info: unknown, ctx?: { issuer?: string }) {
    const key = ctx?.issuer || "default"
    this.store.clientByIssuer[key] = info
    this.persist()
  }

  tokens(ctx?: { issuer?: string }) {
    if (ctx?.issuer && this.store.tokensByIssuer[ctx.issuer]) return this.store.tokensByIssuer[ctx.issuer]
    return this.store.lastTokens
  }

  saveTokens(tokens: StoredOAuthTokens, ctx?: { issuer?: string }) {
    const key = ctx?.issuer || "default"
    this.store.tokensByIssuer[key] = tokens
    this.store.lastTokens = tokens
    this.store.pendingAuthUrl = undefined
    this.persist()
  }

  redirectToAuthorization(authorizationUrl: URL) {
    this.store.pendingAuthUrl = authorizationUrl.toString()
    this.persist()
  }

  saveCodeVerifier(codeVerifier: string) {
    this.store.verifier = codeVerifier
    this.persist()
  }

  codeVerifier() {
    if (!this.store.verifier) throw new Error("Missing PKCE verifier. Click Connect Robinhood again.")
    return this.store.verifier
  }

  saveDiscoveryState(state: OAuthDiscoveryState) {
    this.store.discovery = state
    this.persist()
  }

  discoveryState() {
    return this.store.discovery
  }

  invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery") {
    if (scope === "all") this.store = emptyStore()
    if (scope === "client") this.store.clientByIssuer = {}
    if (scope === "tokens") {
      this.store.tokensByIssuer = {}
      this.store.lastTokens = undefined
    }
    if (scope === "verifier") this.store.verifier = undefined
    if (scope === "discovery") this.store.discovery = undefined
    this.persist()
  }
}
