import "./loadLocalEnv"
import http from "node:http"
import { beginMcpConnect, finishMcpAuth, mcpStatus } from "./rhMcp"
import { REDIRECT_URL } from "./mcpProvider"

async function main() {
  const already = mcpStatus()
  if (already.connected) {
    console.log("Robinhood MCP is already connected.")
    process.exit(0)
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1:5174")
    if (url.pathname !== "/api/mcp/callback" || req.method !== "GET") {
      res.statusCode = 404
      res.end("Not found")
      return
    }
    void finishMcpAuth(url.searchParams).then(() => {
      res.statusCode = 200
      res.setHeader("Content-Type", "text/html; charset=utf-8")
      res.end("<!doctype html><p>Robinhood is connected. You can close this tab.</p>")
      console.log("Robinhood MCP connected.")
      server.close(() => process.exit(0))
    }).catch((err) => {
      const message = err instanceof Error ? err.message : String(err)
      res.statusCode = 400
      res.setHeader("Content-Type", "text/html; charset=utf-8")
      res.end(`<!doctype html><p>${message.replace(/[<>&]/g, "")}</p>`)
      console.error(message)
      server.close(() => process.exit(1))
    })
  })

  server.on("error", (err) => {
    const code = "code" in err ? String(err.code) : ""
    if (code === "EADDRINUSE") {
      console.error("Port 5174 is busy (npm run dev?). Stop it, or click Connect Robinhood in the Desk, then retry.")
    } else {
      console.error(err instanceof Error ? err.message : String(err))
    }
    process.exit(1)
  })

  server.listen(5174, "127.0.0.1", () => {
    void beginMcpConnect(true).then((result) => {
      if (result.connected) {
        console.log("Robinhood MCP connected.")
        server.close(() => process.exit(0))
        return
      }
      const authUrl = result.authUrl
      if (!authUrl) {
        console.error("Robinhood did not return a login URL. Try again.")
        server.close(() => process.exit(1))
        return
      }
      console.log("Open this URL in a browser on THIS machine (Grok Bot's machine, not Yurei's PC):")
      console.log(authUrl)
      console.log(`Waiting for redirect to ${REDIRECT_URL} …`)
    }).catch((err) => {
      console.error(err instanceof Error ? err.message : String(err))
      server.close(() => process.exit(1))
    })
  })
}

void main()
