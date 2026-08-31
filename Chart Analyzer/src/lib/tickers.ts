const TICKER_RE = /\b[A-Z]{2,5}(?:\.[A-Z])?\b/g

const BLOCK = new Set([
  "AH", "AM", "AMEX", "AND", "APR", "ARE", "ASK", "ATR", "ATTACK", "AUG", "AUM", "AVG", "AVERAGE",
  "BE", "BEEN", "BEST", "BETA", "BID", "BREAKOUT", "BUT", "BUY",
  "CALL", "CALLS", "CAN", "CAP", "CASH", "CBOE", "CEO", "CFO", "CHG", "CHANGE", "CHART", "CLASS",
  "CLOSE", "COM", "CORP", "CT",
  "DAY", "DEC", "DOWN",
  "EARLY", "EMA", "EMA20", "EMA50", "EPS", "ETF", "EU",
  "FALSE", "FEB", "FINVIZ", "FLAG", "FLAT", "FLOAT", "FOR", "FRI", "FROM",
  "GTC",
  "HAS", "HAVE", "HER", "HIGH", "HIS", "HOLD", "HOT", "HOW", "HTTP", "HTTPS",
  "IF", "INC", "INTO", "IPO", "IS", "IT", "ITS",
  "JAN", "JUL", "JUN", "JUST",
  "LAST", "LIMIT", "LIST", "LIVE", "LONG", "LOW", "LTD",
  "MACD", "MAR", "MARKET", "MAY", "MID", "MOMENTUM", "MON", "MONTH", "MORE", "MOST", "MT", "MUCH",
  "NAME", "NASDAQ", "NAV", "NEW", "NO", "NONE", "NOT", "NOV", "NOW", "NULL", "NYSE",
  "OCT", "ONLY", "OPEN", "OPTION", "OPTIONS", "OR", "ORDER", "ORDERS", "OTC", "OUR", "OUT", "OVER",
  "PASS", "PCT", "PE", "PLAN", "PM", "PORTFOLIO", "POST", "PRE", "PRICE", "PRICES", "PT", "PULLBACK", "PUT", "PUTS",
  "REV", "RSI",
  "SAT", "SCREENER", "SEC", "SEE", "SELL", "SEP", "SETUP", "SETUPS", "SHARE", "SHARES", "SHORT",
  "SIDE", "SMA", "SO", "SOME", "STOCK", "STOCKS", "STOP", "SUCH", "SUN", "SYMBOL",
  "THAN", "THAT", "THE", "THEM", "THEN", "THEY", "THIS", "THU", "TICKER", "TO", "TODAY", "TOP",
  "TOTAL", "TRADE", "TRADES", "TREND", "TRUE", "TUE",
  "UK", "UP", "US", "USD", "USDC", "USDT",
  "VALUE", "VERY", "VIEW", "VOL", "VOLUME", "VWAP",
  "WAS", "WATCH", "WED", "WEEK", "WHAT", "WHEN", "WHO", "WHY", "WILL", "WITH", "WWW",
  "YEAR", "YOU", "YOUR", "YTD",
])

export function extractTickers(raw: string): string[] {
  const text = raw.toUpperCase().replace(/\$/g, " ")
  const found: string[] = []
  const seen = new Set<string>()
  for (const match of text.match(TICKER_RE) ?? []) {
    if (BLOCK.has(match) || seen.has(match)) continue
    seen.add(match)
    found.push(match)
  }
  return found
}

export function typedSymbols(raw: string): string[] {
  const listed = extractTickers(raw)
  if (listed.length) return listed
  const one = raw.trim().toUpperCase().replace(/^\$/, "")
  if (/^[A-Z][A-Z0-9.]{0,9}$/.test(one)) return [one]
  return []
}

export function mergeTickers(current: string[], incoming: string[]): string[] {
  const seen = new Set(current)
  const next = [...current]
  for (const ticker of incoming) {
    const symbol = ticker.trim().toUpperCase().replace(/^\$/, "")
    if (!symbol || seen.has(symbol)) continue
    seen.add(symbol)
    next.push(symbol)
  }
  return next
}
