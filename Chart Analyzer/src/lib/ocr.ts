import Tesseract from "tesseract.js/dist/tesseract.esm.min.js"
import { extractTickers } from "./tickers"

type OcrWorker = Awaited<ReturnType<typeof Tesseract.createWorker>>

let worker: OcrWorker | null = null
let workerStart: Promise<OcrWorker> | null = null

async function ocrWorker() {
  if (worker) return worker
  if (!workerStart) {
    workerStart = Tesseract.createWorker("eng", 1, {
      workerPath: "https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/worker.min.js",
      corePath: "https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0/tesseract-core.wasm.js",
      langPath: "https://tessdata.projectnaptha.com/4.0.0",
    }).then(async (next) => {
      await next.setParameters({ tessedit_pageseg_mode: "11" as Tesseract.PSM })
      worker = next
      return next
    }).catch((err: unknown) => {
      workerStart = null
      throw err
    })
  }
  return workerStart
}

async function toCanvas(file: File) {
  const bitmap = await createImageBitmap(file)
  const scale = bitmap.width < 1400 ? 2 : 1.35
  const canvas = document.createElement("canvas")
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("Could not read screenshot pixels.")
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = "high"
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const data = image.data
  for (let i = 0; i < data.length; i += 4) {
    const gray = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
    const boosted = gray < 140 ? gray * 0.72 : Math.min(255, (gray - 140) * 1.35 + 140)
    data[i] = data[i + 1] = data[i + 2] = boosted
  }
  ctx.putImageData(image, 0, 0)
  bitmap.close()
  return canvas
}

export async function readTickersFromImages(
  files: File[],
  onProgress?: (done: number, total: number) => void,
): Promise<{ tickers: string[]; text: string }> {
  if (!files.length) return { tickers: [], text: "" }
  const engine = await ocrWorker()
  const chunks: string[] = []
  for (let i = 0; i < files.length; i++) {
    const canvas = await toCanvas(files[i])
    const result = await engine.recognize(canvas)
    chunks.push(result.data.text)
    onProgress?.(i + 1, files.length)
  }
  const text = chunks.join("\n")
  return { tickers: extractTickers(text), text }
}
