import { useEffect, useRef, useState } from "react"
import { ApiError, connectRobinhood, fetchStatus } from "./api"
import { DeskApp, type DeskHandle } from "./desk/DeskApp"
import ScreenerApp from "./screener/ScreenerApp"
import type { BookMode } from "./types"

type Tab = "desk" | "screener"

export default function App() {
  const [tab, setTab] = useState<Tab>("desk")
  const [connected, setConnected] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [bookMode, setBookMode] = useState<BookMode>("live")
  const deskRef = useRef<DeskHandle>(null)

  function openAuth(authUrl: string | null | undefined) {
    if (authUrl) window.location.assign(authUrl)
  }

  async function refreshStatus() {
    const status = await fetchStatus()
    setConnected(status.connected)
  }

  useEffect(() => {
    void refreshStatus().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : String(err))
    })
  }, [])

  async function onConnect() {
    setConnecting(true)
    setError(null)
    try {
      const result = await connectRobinhood()
      if (result.connected) {
        setConnected(true)
        return
      }
      openAuth(result.authUrl)
      if (!result.authUrl) setError("Robinhood did not return a login URL. Try Connect again.")
    } catch (err) {
      if (err instanceof ApiError && err.authUrl) openAuth(err.authUrl)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setConnecting(false)
    }
  }

  async function onRefresh() {
    setTab("desk")
    setRefreshing(true)
    setError(null)
    try {
      await deskRef.current?.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className="station">
      <header className="header">
        <div className="brand">
          <h1>Trade Desk</h1>
        </div>
        <nav className="shell-nav" aria-label="Mode">
          <button
            className={`btn ${tab === "desk" ? "primary" : ""}`}
            type="button"
            aria-current={tab === "desk" ? "page" : undefined}
            onClick={() => setTab("desk")}
          >
            Desk
          </button>
          <button
            className={`btn ${tab === "screener" ? "primary" : ""}`}
            type="button"
            aria-current={tab === "screener" ? "page" : undefined}
            onClick={() => setTab("screener")}
          >
            Screener
          </button>
        </nav>
        <div className="header-meta shell-actions">
          <div className="mode-toggle" role="group" aria-label="Account book">
            <button
              type="button"
              className={bookMode === "live" ? "is-on" : ""}
              onClick={() => void deskRef.current?.setBookMode("live")}
            >
              Live
            </button>
            <button
              type="button"
              className={bookMode === "paper" ? "is-on is-paper" : ""}
              onClick={() => void deskRef.current?.setBookMode("paper")}
            >
              Paper
            </button>
          </div>
          <span>
            Robinhood <strong>{connected ? "connected" : "not connected"}</strong>
          </span>
          <button
            className="btn primary"
            type="button"
            disabled={refreshing}
            onClick={() => void onRefresh()}
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
          {!connected && (
            <button className="btn" type="button" onClick={() => void onConnect()} disabled={connecting}>
              {connecting ? "Opening Robinhood…" : "Connect Robinhood"}
            </button>
          )}
        </div>
      </header>

      {error && tab === "desk" && <div className="banner">{error}</div>}

      <div hidden={tab !== "desk"}>
        <DeskApp
          ref={deskRef}
          connected={connected}
          onNeedsAuth={(authUrl) => {
            setConnected(false)
            openAuth(authUrl)
          }}
          onRefreshed={() => {
            setConnected(true)
            setRefreshing(false)
          }}
          onBookMode={setBookMode}
        />
      </div>
      <div hidden={tab !== "screener"}>
        <ScreenerApp bookMode={bookMode} />
      </div>
    </div>
  )
}
