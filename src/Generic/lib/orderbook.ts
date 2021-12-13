import { Asset } from "xdb-digitalbits-sdk"

/*
 * Quick orderbook cheat sheet:
 *
 * Consider a trading pair T (buy=asset_x, sell=asset_y).
 * The inverse would be T'(buy=asset_y, sell=asset_x).
 *
 * asks(T) === bids(T').map(offer => ({ ...offer, price = 1 / offer.price }))
 * asks(T') === bids(T).map(offer => ({ ...offer, price = 1 / offer.price }))
 *
 * Since the asks & bids are ordered from closest to last trade price to furthest when
 * returned by frontier server, the order of asks(T) & bids(T') is the same as well.
 */

// @types/xdb-digitalbits-sdk types seem wrong
export interface FixedOrderbookOffer {
  price_r: {
    n: number
    d: number
  }
  price: string
  amount: string
}

// @types/xdb-digitalbits-sdk types seem wrong
export interface FixedOrderbookRecord {
  asks: FixedOrderbookOffer[]
  bids: FixedOrderbookOffer[]
  base: Asset
  counter: Asset
}

export function calculateSpread(asks: FixedOrderbookOffer[], bids: FixedOrderbookOffer[]) {
  // TODO: Calculate according to trade volume (because larger volumes will likely lead to larger spreads)

  if (asks.length === 0 || bids.length === 0) {
    return {
      absoluteSpread: 0,
      relativeSpread: 0
    }
  }

  const absoluteSpread = Number.parseFloat(asks[0].price) - Number.parseFloat(bids[0].price)
  const relativeSpread = absoluteSpread / Math.min(Number.parseFloat(asks[0].price), Number.parseFloat(bids[0].price))
  return {
    absoluteSpread,
    relativeSpread
  }
}
