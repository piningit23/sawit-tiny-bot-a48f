// Tiny MA-crossover bot for make.fun bars-replay/v1: long-only EMA(10)/EMA(20).
// Buy when the fast EMA crosses above the slow one, sell on the cross down,
// on a +50% take-profit, or on a -20% stop-loss. Reads hello/batch/done as
// NDJSON on stdin, one reply per batch on stdout. No network, no clock, no
// randomness: the same bars always give the same orders. Paper trading only.
import { createInterface } from "node:readline";
type E = { n: number; w: number[]; v: number | null };
type S = { f: E; s: E; g: number | null; d: boolean };
const F = 10, SLOW = 20, SLIP = 100;
const ema = (e: E, c: number) => { if (e.v !== null) e.v += 2 / (e.n + 1) * (c - e.v); else { e.w.push(c); if (e.w.length === e.n) e.v = e.w.reduce((a, x) => a + x, 0) / e.n; } };
const ser = new Map<string, S>();
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
let hello: any = null;
const out = (o: any) => process.stdout.write(JSON.stringify(o) + "\n");
for await (const line of rl) {
  if (!line.trim()) continue;
  const m = JSON.parse(line);
  if (m.type === "hello") { hello = m; continue; }
  if (m.type === "done") break;
  const up = new Set<string>(), fresh = new Set<string>();
  for (const b of m.bars) {
    let s = ser.get(b.symbol);
    if (!s) { s = { f: { n: F, w: [], v: null }, s: { n: SLOW, w: [], v: null }, g: null, d: false }; ser.set(b.symbol, s); }
    const c = Number(b.c); ema(s.f, c); ema(s.s, c);
    const now = s.f.v !== null && s.s.v !== null ? s.f.v - s.s.v : null;
    if (now !== null && s.g !== null) { if (now > 0 && s.g <= 0) up.add(b.symbol); if (now < 0 && s.g >= 0) s.d = true; }
    if (now === null || now >= 0) s.d = false;
    s.g = now; fresh.add(b.symbol);
  }
  if (m.seq < (hello.warmup_bars || 0)) { out({ type: "reply", seq: m.seq, orders: [] }); continue; }
  const pos = new Map(m.account.positions.map((p: any) => [p.symbol, p]));
  const syms = (hello.symbols as any[]).map((x: any) => x.symbol);
  const eq = BigInt(m.account.equity_quote_units);
  const cap = hello.caps.max_orders_per_bar, minN = BigInt(hello.fees.min_notional_quote_units);
  const orders: any[] = [];
  let cash = BigInt(m.account.cash_quote_units);
  for (const sym of syms) {
    if (!fresh.has(sym)) continue;
    const h = pos.get(sym);
    if (h) {
      const bar = m.bars.find((b: any) => b.symbol === sym);
      const sc = hello.symbols.find((x: any) => x.symbol === sym);
      const val = BigInt(h.qty) * BigInt(bar.c) * 10n ** BigInt(hello.capital.quote_scale) / 10n ** (BigInt(sc.qty_scale) + BigInt(sc.price_scale));
      if (ser.get(sym)!.d || val * 2n >= BigInt(h.cost_quote_units) * 3n || val * 5n <= BigInt(h.cost_quote_units) * 4n)
        orders.push({ side: "sell", client_id: `s${m.seq}-${sym}`, symbol: sym, qty: h.qty, max_slippage_bps: SLIP });
    } else if (up.has(sym) && orders.length < cap) {
      const slots = Math.min(syms.length, hello.caps.max_open_positions);
      let slice = eq / BigInt(slots);
      const byW = BigInt(hello.caps.max_weight_bps) * eq / 10000n;
      if (slice > byW) slice = byW;
      if (slice > cash) slice = cash;
      if (slice >= minN) { orders.push({ side: "buy", client_id: `b${m.seq}-${sym}`, symbol: sym, notional_quote_units: slice.toString(), max_slippage_bps: SLIP }); cash -= slice; }
    }
  }
  out({ type: "reply", seq: m.seq, orders });
}
