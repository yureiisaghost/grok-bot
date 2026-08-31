import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import { analyzerApiPlugin } from "./server/plugin"

export default defineConfig({
  plugins: [react(), analyzerApiPlugin()],
  optimizeDeps: {
    exclude: ["@modelcontextprotocol/client"],
    include: ["tesseract.js"],
  },
  server: {
    host: "127.0.0.1",
    port: 5174,
    strictPort: true,
  },
  preview: {
    host: "127.0.0.1",
    port: 5174,
    strictPort: true,
  },
})
