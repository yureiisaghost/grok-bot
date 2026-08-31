import { useState } from "react"

interface ConnectPanelProps {
  message?: string
  mfaRequired?: boolean
  needsDeviceApproval?: boolean
  busy: boolean
  onLogin: (username: string, password: string, mfaCode?: string) => void
  onContinue: () => void
}

export function ConnectPanel({
  message,
  mfaRequired,
  needsDeviceApproval,
  busy,
  onLogin,
  onContinue,
}: ConnectPanelProps) {
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [mfaCode, setMfaCode] = useState("")

  return (
    <div className="panel connect">
      <h2>Connect Robinhood</h2>
      <p>
        Localhost only. Session tokens are stored in your user folder
        (<span className="tiny">~/.grok-trading</span>), not in Google Drive.
        This app cannot place orders.
      </p>
      {message && <div className="banner warn">{message}</div>}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          onLogin(username, password, mfaCode || undefined)
        }}
      >
        <div className="field">
          <label htmlFor="rh-user">Username / email</label>
          <input id="rh-user" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="rh-pass">Password</label>
          <input id="rh-pass" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="rh-mfa">Authenticator code (if asked)</label>
          <input id="rh-mfa" inputMode="numeric" autoComplete="one-time-code" value={mfaCode} onChange={(e) => setMfaCode(e.target.value)} />
        </div>
        <div className="actions">
          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? "Connecting…" : "Connect"}
          </button>
          {(needsDeviceApproval || mfaRequired) && (
            <button className="btn" type="button" disabled={busy} onClick={onContinue}>
              Continue after approval
            </button>
          )}
        </div>
      </form>
    </div>
  )
}
