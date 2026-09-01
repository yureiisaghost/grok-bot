interface HeaderProps {
  tickerCount: number
  candidateCount: number
  developingCount: number
  passCount: number
  failCount: number
  skipCount?: number
  fileName?: string | null
  bookLabel?: string | null
  bookEquity?: number | null
  placeCashOrders?: boolean
}

export function Header({
  tickerCount,
  candidateCount,
  developingCount,
  passCount,
  failCount,
  skipCount = 0,
  fileName,
  bookLabel,
  bookEquity,
  placeCashOrders,
}: HeaderProps) {
  return (
    <div className="header sub">
      <div className="header-meta">
        {bookLabel && (
          <span>
            Sizing <strong>{bookLabel}</strong>
            {bookEquity != null ? <> · {bookEquity.toLocaleString("en-US", { style: "currency", currency: "USD" })}</> : null}
            {placeCashOrders === false ? " · do not place cash orders" : null}
          </span>
        )}
        {(candidateCount + developingCount + passCount + failCount + skipCount) > 0 && (
          <span>
            Keepers <strong>{candidateCount} Candidate</strong> · <strong>{developingCount} Developing</strong>
            {passCount > 0 ? <> · pass {passCount}</> : null}
            {failCount > 0 ? <> · failed {failCount}</> : null}
            {skipCount > 0 ? <> · skipped {skipCount} under $5</> : null}
          </span>
        )}
        <span>
          Desk list <strong>{tickerCount}</strong>
          {fileName ? <> · <strong>{fileName}</strong></> : " — save keepers for the Desk"}
        </span>
      </div>
    </div>
  )
}
