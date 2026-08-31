interface HeaderProps {
  tickerCount: number
  candidateCount: number
  developingCount: number
  passCount: number
  failCount: number
  skipCount?: number
  fileName?: string | null
}

export function Header({
  tickerCount,
  candidateCount,
  developingCount,
  passCount,
  failCount,
  skipCount = 0,
  fileName,
}: HeaderProps) {
  return (
    <div className="header sub">
      <div className="header-meta">
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
