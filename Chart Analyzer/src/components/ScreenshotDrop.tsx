import { useState } from "react"
import { isScreenerCsv } from "../lib/screener"

export interface Shot {
  id: string
  file: File
  url: string
}

function isIntakeFile(file: File) {
  return file.type.startsWith("image/") || isScreenerCsv(file)
}

export function ScreenshotDrop({
  shots,
  csvNames,
  busy,
  progress,
  onAddFiles,
  onRemove,
}: {
  shots: Shot[]
  csvNames: string[]
  busy: boolean
  progress: string | null
  onAddFiles: (files: File[]) => void
  onRemove: (id: string) => void
}) {
  const [over, setOver] = useState(false)

  function takeFiles(list: FileList | File[] | null) {
    if (!list) return
    const files = [...list].filter(isIntakeFile)
    if (files.length) onAddFiles(files)
  }

  return (
    <div
      className={`shot-drop${busy ? " is-busy" : ""}${over ? " is-over" : ""}`}
      onDragOver={(event) => {
        event.preventDefault()
        setOver(true)
      }}
      onDragEnter={(event) => {
        event.preventDefault()
        setOver(true)
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
        setOver(false)
      }}
      onDrop={(event) => {
        event.preventDefault()
        setOver(false)
        takeFiles(event.dataTransfer.files)
      }}
    >
      <input
        id="shot-input"
        className="shot-input"
        type="file"
        accept=".csv,text/csv,image/*"
        multiple
        disabled={busy}
        onChange={(event) => {
          takeFiles(event.target.files)
          event.target.value = ""
        }}
      />
      <label htmlFor="shot-input" className="shot-label">
        <strong>Drop a TradingView CSV, or click to browse</strong>
        <span>The table lists every name from the CSV. Run All grades Candidate, Developing, or Pass. Save writes the list the Desk Refresh uses.</span>
        {progress && <span className="shot-progress">{progress}</span>}
      </label>
      {csvNames.length > 0 && (
        <div className="csv-row">
          {csvNames.map((name) => (
            <span className="csv-pill" key={name} title={name}>{name}</span>
          ))}
        </div>
      )}
      {shots.length > 0 && (
        <div className="shot-row">
          {shots.map((shot) => (
            <div className="shot-thumb" key={shot.id}>
              <img src={shot.url} alt={shot.file.name} />
              <button type="button" className="shot-x" onClick={() => onRemove(shot.id)} disabled={busy}>
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
