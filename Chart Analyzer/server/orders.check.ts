import { collectOpenBuys, collectOpenStops } from "./orders"

let failed = 0
function check(name: string, ok: boolean, detail: string) {
  if (ok) console.log(`ok  ${name}`)
  else {
    failed += 1
    console.error(`FAIL  ${name} — ${detail}`)
  }
}

const page = {
  orders: [
    { symbol: "QGEN", side: "sell", type: "market", trigger: "stop", state: "confirmed", stop_price: "41.420000" },
    { symbol: "RITM", side: "sell", type: "market", trigger: "stop", state: "confirmed", stop_price: "9.870000" },
    { symbol: "RITM", side: "buy", type: "limit", trigger: "stop", state: "filled", stop_price: "10.120000" },
    { symbol: "OLD", side: "sell", type: "market", trigger: "stop", state: "cancelled", stop_price: "5" },
    { symbol: "BUY", side: "buy", type: "market", trigger: "stop", state: "confirmed", stop_price: "12" },
  ],
}

const stops = collectOpenStops([page])
check("keeps confirmed sell-stops", stops.get("QGEN") === 41.42 && stops.get("RITM") === 9.87, JSON.stringify([...stops]))
check("drops filled and cancelled", !stops.has("OLD") && !stops.has("BUY"), JSON.stringify([...stops.keys()]))

const buys = collectOpenBuys([page])
check("keeps confirmed buy-stops", buys.length === 1 && buys[0]?.ticker === "BUY" && buys[0]?.stopPrice === 12, JSON.stringify(buys))

const liveBuys = collectOpenBuys([{
  orders: [
    { symbol: "SGMT", side: "buy", type: "limit", trigger: "stop", state: "confirmed", quantity: "1", stop_price: "11.18", price: "11.40" },
    { symbol: "SGMT", side: "buy", type: "limit", trigger: "stop", state: "filled", quantity: "1", stop_price: "11.18", price: "11.40" },
    { symbol: "XMAX", side: "sell", type: "limit", trigger: "stop", state: "confirmed", quantity: "1", stop_price: "8.86" },
  ],
}])
check("pending buy is SGMT only", liveBuys.length === 1 && liveBuys[0]?.ticker === "SGMT" && liveBuys[0]?.limitPrice === 11.4, JSON.stringify(liveBuys))

const tighter = collectOpenStops([
  page,
  { orders: [{ symbol: "QGEN", side: "sell", type: "stop_limit", trigger: "stop", state: "queued", stop_price: 41.9 }] },
])
check("higher live stop wins", tighter.get("QGEN") === 41.9, String(tighter.get("QGEN")))

if (failed) {
  console.error(`\n${failed} order checks failed`)
  process.exit(1)
}
console.log("\nall order checks passed")
