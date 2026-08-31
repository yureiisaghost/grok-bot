/// <reference types="vite/client" />

declare module "*.css"

declare module "tesseract.js/dist/tesseract.esm.min.js" {
  import Tesseract from "tesseract.js"
  export default Tesseract
}
