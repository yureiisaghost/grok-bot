import { loadEnvFile } from "./session"
import path from "node:path"
import { fileURLToPath } from "node:url"

const analyzerDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
loadEnvFile(path.join(analyzerDir, ".env"))
