import "eventsource"
import DebugLogger from "debug"
import throttle from "lodash.throttle"
import { filter, flatMap, map, merge, multicast, Observable } from "observable-fns"
import PromiseQueue from "p-queue"
import qs from "qs"
import { Asset, Frontier, Networks, Server, ServerApi, Transaction } from "xdb-digitalbits-sdk"
import pkg from "../../../package.json"
import { Cancellation, CustomError } from "~Generic/lib/errors"
import { observableFromAsyncFactory } from "~Generic/lib/observables"
import { parseAssetID } from "~Generic/lib/digitalbits"
import { max } from "~Generic/lib/strings"
import { createReconnectingSSE } from "../lib/event-source"
import { parseJSONResponse } from "../lib/rest"
import { resetSubscriptions, subscribeToUpdatesAndPoll } from "../lib/subscription"
import { ServiceID } from "./errors"
import {
  accountDataUpdates,
  offerUpdates,
  handleSubmittedTransaction,
  optimisticallyUpdateAccountData,
  optimisticallyUpdateOffers,
  removeStaleOptimisticUpdates,
  OptimisticAccountUpdate,
  OptimisticOfferUpdate
} from "./optimistic-updates/index"

export interface CollectionPage<T> {
  _embedded: {
    records: T[]
  }
  _links: {
    self: {
      href: string
    }
    next: {
      href: string
    }
    prev: {
      href: string
    }
  }
}

interface FeeStatsDetails {
  max: string
  min: string
  mode: string
  p10: string
  p20: string
  p30: string
  p40: string
  p50: string
  p60: string
  p70: string
  p80: string
  p90: string
  p95: string
  p99: string
}

// See <https://www.stellar.org/developers/horizon/reference/endpoints/fee-stats.html>
interface FeeStats {
  last_ledger: string
  last_ledger_base_fee: string
  ledger_capacity_usage: string
  fee_charged: FeeStatsDetails
  max_fee: FeeStatsDetails
}

const accountSubscriptionCache = new Map<string, Observable<Frontier.AccountResponse>>()
const effectsSubscriptionCache = new Map<string, Observable<ServerApi.EffectRecord>>()
const orderbookSubscriptionCache = new Map<string, Observable<ServerApi.OrderbookRecord>>()
const ordersSubscriptionCache = new Map<string, Observable<ServerApi.OfferRecord[]>>()
const transactionsSubscriptionCache = new Map<string, Observable<Frontier.TransactionResponse>>()

const accountDataCache = new Map<string, Frontier.AccountResponse | null>()
const accountDataWaitingCache = new Map<string, ReturnType<typeof waitForAccountDataUncached>>()

// Rate-limit concurrent fetches
const fetchQueuesByFrontier = new Map<string, PromiseQueue>()

const identification = {
  "X-Client-Name": "AstraX",
  "X-Client-Version": pkg.version
}

const createAccountCacheKey = (frontierURLs: string[], accountID: string) =>
  `${frontierURLs.map(url => `${url}:`)}${accountID}`
// const createAccountCacheKey = (frontierURL: string, accountID: string) => `${frontierURL}:${accountID}`
const createOrderbookCacheKey = (frontierURLs: string[], sellingAsset: string, buyingAsset: string) =>
  `${frontierURLs.map(url => `${url}:`)}${sellingAsset}:${buyingAsset}`

const debugFrontierSelection = DebugLogger("net-worker:select-frontier")
const debugSubscriptionReset = DebugLogger("net-worker:reset-subscriptions")

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

let roundRobinIndex = 0
function getRandomURL(frontierURLs: string[]) {
  const url = frontierURLs[roundRobinIndex % frontierURLs.length]
  roundRobinIndex += 1
  return url
}

function getFetchQueue(frontierURL: string): PromiseQueue {
  if (!fetchQueuesByFrontier.has(frontierURL)) {
    const fetchQueue = new PromiseQueue({
      concurrency: 4,
      interval: 1000,
      intervalCap: 4,
      timeout: 10000,
      throwOnTimeout: true
    })
    fetchQueuesByFrontier.set(frontierURL, fetchQueue)
  }

  return fetchQueuesByFrontier.get(frontierURL)!
}

function getServiceID(frontierURL: string): ServiceID {
  return /testnet/.test(frontierURL) ? ServiceID.FrontierTestnet : ServiceID.FrontierPublic
}

function cachify<T, Args extends any[]>(
  cache: Map<string, Observable<T>>,
  subscribe: (...args: Args) => Observable<T>,
  createCacheKey: (...args: Args) => string
): (...args: Args) => Observable<T> {
  return (...args: Args) => {
    const cacheKey = createCacheKey(...args)
    const cached = cache.get(cacheKey)

    if (cached) {
      return cached
    } else {
      const observable = subscribe(...args)
      cache.set(cacheKey, observable)
      return observable
    }
  }
}

export async function checkFrontierOrFailover(primaryFrontierURL: string, secondaryFrontierURL: string) {
  const debug = debugFrontierSelection
  // Account ID of friendbot (account exists on pubnet, too)
  const testAccountID = "GAIH3ULLFQ4DGSECF2AR555KZ4KNDGEKN4AFI4SU2M7B43MGK3QJZNSR"

  try {
    // fetch dynamic data to check database access
    const primaryResponse = await Promise.race([
      fetch(new URL(`/accounts/${testAccountID}`, primaryFrontierURL).href),
      delay(2500).then(() => {
        throw Error(`Frontier health check timed out. Trying failover…`)
      })
    ])

    if (primaryResponse.status < 300 || primaryResponse.status === 404) {
      // consider request successful on 404 as well (account might be missing but frontier is working)
      debug(`Primary frontier server seems fine:`, primaryFrontierURL)
      return primaryFrontierURL
    }
  } catch (error) {
    // tslint:disable-next-line no-console
    console.error(error)
  }

  const secondaryResponse = await fetch(new URL(`/accounts/${testAccountID}`, secondaryFrontierURL).href)
  const serverToUse =
    secondaryResponse.status < 300 || secondaryResponse.status === 404 ? secondaryFrontierURL : primaryFrontierURL

  debug(`Primary frontier server check failed. Using ${serverToUse}`)
  return serverToUse
}

export function resetAllSubscriptions() {
  debugSubscriptionReset(`Resetting all active subscriptions…`)

  accountSubscriptionCache.clear()
  effectsSubscriptionCache.clear()
  orderbookSubscriptionCache.clear()
  ordersSubscriptionCache.clear()
  transactionsSubscriptionCache.clear()
  resetSubscriptions()
}

export async function submitTransaction(frontierURL: string, txEnvelopeXdr: string, network: Networks) {
  const fetchQueue = getFetchQueue(frontierURL)
  const url = new URL(`/transactions?${qs.stringify({ tx: txEnvelopeXdr })}`, frontierURL)

  const response = await fetchQueue.add(
    () => {
      return fetch(String(url), {
        method: "POST"
      })
    },
    { priority: 20 }
  )

  //ERROR

  if (response.status === 200) {
    handleSubmittedTransaction(frontierURL, new Transaction(txEnvelopeXdr, network))
  }

  return {
    status: response.status,
    data: await response.json()
  }
}

async function waitForAccountDataUncached(frontierURL: string, accountID: string, shouldCancel?: () => boolean) {
  const fetchQueue = getFetchQueue(frontierURL)
  const debug = DebugLogger(`net-worker:wait-for-account:${accountID}`)

  let accountData = null
  let initialFetchFailed = false

  for (let interval = 2500; ; interval = Math.min(interval * 1.05, 5000)) {
    if (shouldCancel && shouldCancel()) {
      debug(`Received signal to cancel waiting for account to be created`)
      throw Cancellation("Stopping to wait for account to become present in network.")
    }

    const url = new URL(`/accounts/${accountID}?${qs.stringify(identification)}`, frontierURL)
    const response = await fetchQueue.add(() => fetch(String(url)))

    if (response.status === 200) {
      accountData = await parseJSONResponse<Frontier.AccountResponse>(response)
      break
    } else if (response.status === 404) {
      initialFetchFailed = true
      await delay(interval)
    } else {
      throw CustomError("RequestFailedError", `Request to ${response.url} failed with status ${response.status}`, {
        target: response.url,
        status: response.status
      })
    }
  }

  debug(`Successfully fetched account meta data. ${initialFetchFailed ? "Had to wait." : ""}`)

  return {
    accountData,
    initialFetchFailed
  }
}

async function waitForAccountData(frontierURLs: string[], accountID: string, shouldCancel?: () => boolean) {
  // Cache promise to make sure we don't poll the same account twice simultaneously
  const cacheKey = createAccountCacheKey(frontierURLs, accountID)
  const pending = accountDataWaitingCache.get(cacheKey)
  const frontierURL = getRandomURL(frontierURLs)

  if (pending) {
    return pending
  } else {
    const justStarted = waitForAccountDataUncached(frontierURL, accountID, shouldCancel)
    accountDataWaitingCache.set(cacheKey, justStarted)
    justStarted.then(
      () => accountDataWaitingCache.delete(cacheKey),
      () => accountDataWaitingCache.delete(cacheKey)
    )
    return justStarted
  }
}

function subscribeToAccountEffectsUncached(frontierURLs: string[], accountID: string) {
  const frontierURL = getRandomURL(frontierURLs)
  const fetchQueue = getFetchQueue(frontierURL)
  const debug = DebugLogger(`net-worker:subscriptions:account-effects:${accountID}`)
  const serviceID = getServiceID(frontierURL)

  let latestCursor: string | undefined
  let latestEffectCreatedAt: string | undefined

  return subscribeToUpdatesAndPoll<ServerApi.EffectRecord>(
    {
      async applyUpdate(update) {
        debug(`Received new effect:`, update)
        latestCursor = update.paging_token
        latestEffectCreatedAt = update.created_at
        return update
      },
      async fetchUpdate(streamedUpdate) {
        if (streamedUpdate) {
          return streamedUpdate
        } else {
          const effect = await fetchLatestAccountEffect(frontierURL, accountID)
          return effect || undefined
        }
      },
      async init() {
        debug(`Subscribing to account effects…`)
        let effect = await fetchLatestAccountEffect(frontierURL, accountID)

        if (!effect) {
          debug(`Waiting for account to be created on the network…`)
          await waitForAccountData(frontierURLs, accountID)
          effect = await fetchLatestAccountEffect(frontierURL, accountID)
        }

        latestCursor = effect ? effect.paging_token : latestCursor
        latestEffectCreatedAt = effect ? effect.created_at : latestEffectCreatedAt

        return effect || undefined
      },
      shouldApplyUpdate(update) {
        return (
          !latestEffectCreatedAt || (update.created_at >= latestEffectCreatedAt && update.paging_token !== latestCursor)
        )
      },
      subscribeToUpdates() {
        const createURL = () => {
          const query = {
            ...identification,
            cursor: latestCursor || "now"
          }
          return String(new URL(`/accounts/${accountID}/effects?${qs.stringify(query)}`, frontierURL))
        }

        return multicast(
          observableFromAsyncFactory<ServerApi.EffectRecord>(async observer => {
            return fetchQueue.add(() =>
              createReconnectingSSE(
                createURL,
                {
                  onMessage(message) {
                    const effect: ServerApi.EffectRecord = JSON.parse(message.data)

                    // Don't update latestCursor cursor here – if we do it too early it might cause
                    // shouldApplyUpdate() to return false, since it compares the new effect with itself
                    observer.next(effect)

                    if (effect.type === "account_removed" && effect.account === accountID) {
                      debug(`Closing subscription as account has been merged.`)
                      observer.complete()
                    }
                  },
                  onUnexpectedError(error) {
                    debug(`Unexpected error:`, error)
                    observer.error(error)
                  }
                },
                fetchQueue.add.bind(fetchQueue)
              )
            )
          })
        )
      }
    },
    serviceID,
    {
      retryFetchOnNoUpdate: false
    }
  )
}

export const subscribeToAccountEffects = cachify(
  effectsSubscriptionCache,
  subscribeToAccountEffectsUncached,
  createAccountCacheKey
)

function subscribeToAccountUncached(frontierURLs: string[], accountID: string) {
  const debug = DebugLogger(`net-worker:subscriptions:account:${accountID}`)
  const frontierURL = getRandomURL(frontierURLs)
  const serviceID = getServiceID(frontierURL)

  let latestSnapshot: string | undefined

  const cacheKey = createAccountCacheKey(frontierURLs, accountID)
  const createSnapshot = (accountData: Frontier.AccountResponse) =>
    JSON.stringify([accountData.sequence, accountData.balances])

  return subscribeToUpdatesAndPoll<Frontier.AccountResponse | null>(
    {
      async applyUpdate(update) {
        if (update) {
          debug(`Received account meta data update:`, update)
          accountDataCache.set(cacheKey, update)
          latestSnapshot = createSnapshot(update)
        }
        return update
      },
      async fetchUpdate() {
        debug(`Fetching update…`)
        const accountData = await fetchAccountData(frontierURLs, accountID)
        return accountData || undefined
      },
      async init() {
        debug(`Subscribing to account meta data updates…`)
        const lastKnownAccountData = accountDataCache.get(cacheKey)

        if (lastKnownAccountData) {
          latestSnapshot = createSnapshot(lastKnownAccountData)
          return lastKnownAccountData
        } else {
          const { accountData: initialAccountData } = await waitForAccountData(frontierURLs, accountID)

          accountDataCache.set(cacheKey, initialAccountData)
          // Don't set `latestSnapshot` yet or the value will initially not be emitted

          return initialAccountData
        }
      },
      shouldApplyUpdate(update) {
        return Boolean(update && (!latestSnapshot || createSnapshot(update) !== latestSnapshot))
      },
      subscribeToUpdates() {
        const handleNewOptimisticUpdate = (newOptimisticUpdate: OptimisticAccountUpdate) => {
          const accountData = accountDataCache.get(cacheKey)

          if (newOptimisticUpdate.effectsAccountID === accountID && newOptimisticUpdate.frontierURL === frontierURL) {
            return accountData ? optimisticallyUpdateAccountData(frontierURL, accountData) : accountData
          } else {
            return accountData
          }
        }
        return merge(
          // Update whenever we receive an account effect push notification
          subscribeToAccountEffects(frontierURLs, accountID).pipe(map(() => fetchAccountData(frontierURLs, accountID))),
          // Update on new optimistic updates
          accountDataUpdates.observe().pipe(
            map(handleNewOptimisticUpdate),
            filter(accountData => Boolean(accountData))
          ),
          // Initially fetch data with a delay to make sure we don't miss anything
          Observable.from([0]).pipe(
            map(async () => {
              await delay(1000)
              return fetchAccountData(frontierURLs, accountID)
            })
          )
        )
      }
    },
    serviceID
  )
}

export const subscribeToAccount = cachify(accountSubscriptionCache, subscribeToAccountUncached, createAccountCacheKey)

function subscribeToAccountTransactionsUncached(frontierURLs: string[], accountID: string) {
  const debug = DebugLogger(`net-worker:subscriptions:account-transactions:${accountID}`)

  let latestCursor: string | undefined

  const fetchInitial = async () => {
    const page = await fetchAccountTransactions(frontierURLs, accountID, {
      limit: 1,
      order: "desc"
    })
    const latestTxs = page._embedded.records

    if (latestTxs.length > 0) {
      latestCursor = latestTxs[0].paging_token
    }
  }

  const fetchLatestTxs = throttle(
    async () => {
      debug(`Fetching latest transactions…`)

      if (latestCursor) {
        const page = await fetchAccountTransactions(frontierURLs, accountID, { cursor: latestCursor, limit: 10 })
        return [page, "asc"] as const
      } else {
        const page = await fetchAccountTransactions(frontierURLs, accountID, { limit: 10, order: "desc" })
        return [page, "desc"] as const
      }
    },
    200,
    { leading: true, trailing: true }
  )

  debug(`Subscribing to account's transactions…`)

  fetchInitial().catch(error => {
    // tslint:disable-next-line no-console
    console.error(error)
  })

  return multicast(
    subscribeToAccountEffects(frontierURLs, accountID).pipe(
      flatMap(async function*(): AsyncIterableIterator<Frontier.TransactionResponse> {
        for (let i = 0; i < 3; i++) {
          const [page, order] = await fetchLatestTxs()
          const newTxs = order === "asc" ? page._embedded.records : page._embedded.records.reverse()

          yield* newTxs

          if (newTxs.length > 0) {
            debug(`Received new transactions:`, newTxs)

            const latestTx = newTxs[newTxs.length - 1]
            latestCursor = latestTx.paging_token
          }

          // There might be race conditions between the different frontier endpoints
          // Wait 350ms, then fetch again, in case the previous fetch didn't return the latest txs yet
          await delay(350)
        }
      })
    )
  )
}

export const subscribeToAccountTransactions = cachify(
  transactionsSubscriptionCache,
  subscribeToAccountTransactionsUncached,
  createAccountCacheKey
)

function subscribeToOpenOrdersUncached(frontierURLs: string[], accountID: string) {
  const debug = DebugLogger(`net-worker:subscriptions:account-orders:${accountID}`)
  const frontierURL = getRandomURL(frontierURLs)
  const serviceID = getServiceID(frontierURL)

  let latestCursor: string | undefined
  let latestSet: ServerApi.OfferRecord[] = []

  const fetchUpdate = async () => {
    debug(`Fetching account's open orders…`)

    // Don't use latest cursor as we want to fetch all open orders
    // (otherwise we could not handle order deletions)
    const page = await fetchAccountOpenOrders(frontierURLs, accountID, { order: "desc" })
    return page._embedded.records
  }

  return subscribeToUpdatesAndPoll<ServerApi.OfferRecord[]>(
    {
      async applyUpdate(update) {
        debug(`Received updated open orders:`, update)

        if (update.length > 0) {
          const latestID = max(
            update.map(offer => String(offer.id)),
            "0"
          )
          latestCursor = update.find(offer => String(offer.id) === latestID)!.paging_token
        }

        latestSet = update
        return update
      },
      fetchUpdate,
      async init() {
        debug(`Subscribing to open orders…`)
        const records = await fetchUpdate()

        if (records.length > 0) {
          latestCursor = records[0].paging_token
        }

        latestSet = records
        return records
      },
      shouldApplyUpdate(update) {
        const latestUpdateCursor = max(
          update.map(record => record.paging_token),
          "0"
        )
        const emptySet = update.length === 0
        const latestSetEmpty = latestSet.length === 0
        return emptySet !== latestSetEmpty || (!emptySet && latestUpdateCursor !== latestCursor)
      },
      subscribeToUpdates() {
        const handleNewOptimisticUpdate = (newOptimisticUpdate: OptimisticOfferUpdate) => {
          if (newOptimisticUpdate.effectsAccountID === accountID && newOptimisticUpdate.frontierURL === frontierURL) {
            return optimisticallyUpdateOffers(frontierURL, accountID, latestSet)
          } else {
            return latestSet
          }
        }
        // We somewhat rely on the optimistic updates as a trigger to fetch
        // actual on-ledger data as the open orders SSE stream turns out to be
        // unreliable and the account effects stream only indicates a trade
        // happening, not the creation/cancellation of one
        return merge(
          subscribeToAccountEffects(frontierURLs, accountID).pipe(map(() => fetchUpdate())),
          offerUpdates.observe().pipe(map(handleNewOptimisticUpdate))
        )
      }
    },
    serviceID
  )
}

export const subscribeToOpenOrders = cachify(
  ordersSubscriptionCache,
  subscribeToOpenOrdersUncached,
  createAccountCacheKey
)

function createOrderbookQuery(selling: Asset, buying: Asset) {
  const query: any = { limit: 100 }

  query.buying_asset_type = buying.getAssetType()
  query.selling_asset_type = selling.getAssetType()

  if (!buying.isNative()) {
    query.buying_asset_code = buying.getCode()
    query.buying_asset_issuer = buying.getIssuer()
  }
  if (!selling.isNative()) {
    query.selling_asset_code = selling.getCode()
    query.selling_asset_issuer = selling.getIssuer()
  }

  return query
}

function createEmptyOrderbookRecord(base: Asset, counter: Asset): ServerApi.OrderbookRecord {
  return {
    _links: {
      self: {
        href: ""
      }
    },
    asks: [],
    bids: [],
    base,
    counter
  }
}

function subscribeToOrderbookUncached(frontierURLs: string[], sellingAsset: string, buyingAsset: string) {
  const debug = DebugLogger(`net-worker:subscriptions:orderbook:${buyingAsset}-${sellingAsset}`)

  const buying = parseAssetID(buyingAsset)
  const selling = parseAssetID(sellingAsset)
  const query = createOrderbookQuery(selling, buying)

  if (selling.equals(buying)) {
    return Observable.from<ServerApi.OrderbookRecord>([createEmptyOrderbookRecord(buying, buying)])
  }

  const frontierURL = getRandomURL(frontierURLs)
  const createURL = () => String(new URL(`/order_book?${qs.stringify({ ...query, cursor: "now" })}`, frontierURL))
  const fetchUpdate = () => fetchOrderbookRecord(frontierURLs, sellingAsset, buyingAsset)

  let latestKnownSnapshot = ""
  const fetchQueue = getFetchQueue(frontierURL)
  const serviceID = getServiceID(frontierURL)

  // TODO: Optimize - Make UpdateT = ValueT & { [$snapshot]: string }

  return subscribeToUpdatesAndPoll(
    {
      async applyUpdate(update) {
        debug(`Received order book update:`, update)
        latestKnownSnapshot = JSON.stringify(update)
        return update
      },
      fetchUpdate,
      async init() {
        debug(`Subscribing to order book…`)
        const record = await fetchUpdate()
        latestKnownSnapshot = JSON.stringify(record)
        return record
      },
      shouldApplyUpdate(update) {
        const snapshot = JSON.stringify(update)
        return snapshot !== latestKnownSnapshot
      },
      subscribeToUpdates() {
        return observableFromAsyncFactory<ServerApi.OrderbookRecord>(observer => {
          return fetchQueue.add(() =>
            createReconnectingSSE(
              createURL,
              {
                onMessage(message) {
                  const record: ServerApi.OrderbookRecord = JSON.parse(message.data)
                  observer.next(record)
                },
                onUnexpectedError(error) {
                  debug(`Unexpected error:`, error)
                  observer.error(error)
                }
              },
              fetchQueue.add.bind(fetchQueue)
            )
          )
        })
      }
    },
    serviceID
  )
}

export const subscribeToOrderbook = cachify(
  orderbookSubscriptionCache,
  subscribeToOrderbookUncached,
  createOrderbookCacheKey
)

export interface PaginationOptions {
  cursor?: string
  limit?: number
  order?: "asc" | "desc"
}

export async function fetchAccountData(
  frontierURLs: string | string[],
  accountID: string,
  priority: number = 2
): Promise<(Frontier.AccountResponse & { home_domain?: string | undefined }) | null> {
  const frontierURL = Array.isArray(frontierURLs) ? getRandomURL(frontierURLs) : frontierURLs
  const fetchQueue = getFetchQueue(frontierURL)
  const url = new URL(`/accounts/${accountID}?${qs.stringify(identification)}`, frontierURL)
  const response = await fetchQueue.add(() => fetch(String(url)), { priority })

  if (response.status === 404) {
    return null
  }

  const accountData = await parseJSONResponse<Frontier.AccountResponse & { home_domain: string | undefined }>(response)
  // FIXME: Add support for liquidity pools
  // Remove liquidity pools from account data
  accountData.balances = accountData.balances.filter(b => b.asset_type !== "liquidity_pool_shares")
  return optimisticallyUpdateAccountData(frontierURL, accountData)
}

export async function fetchLatestAccountEffect(frontierURL: string, accountID: string) {
  const fetchQueue = getFetchQueue(frontierURL)
  const url = new URL(
    `/accounts/${accountID}/effects?${qs.stringify({
      ...identification,
      limit: 1,
      order: "desc"
    })}`,
    frontierURL
  )

  const response = await fetchQueue.add(() => fetch(String(url)), { priority: 2 })

  if (response.status === 404) {
    return null
  }

  return parseJSONResponse<ServerApi.EffectRecord>(response)
}

export interface FetchTransactionsOptions extends PaginationOptions {
  emptyOn404?: boolean
}

export async function fetchAccountTransactions(
  frontierURLs: string[],
  accountID: string,
  options: FetchTransactionsOptions = {}
): Promise<CollectionPage<Frontier.TransactionResponse>> {
  const frontierURL = getRandomURL(frontierURLs)
  const fetchQueue = getFetchQueue(frontierURL)
  const pagination = {
    cursor: options.cursor,
    limit: options.limit,
    order: options.order
  }
  const url = new URL(
    `/accounts/${accountID}/transactions?${qs.stringify({ ...identification, ...pagination })}`,
    frontierURL
  )
  const response = await fetchQueue.add(() => fetch(String(url)), { priority: 1 })

  if (response.status === 404 && options.emptyOn404) {
    return {
      _links: {
        next: { href: String(url) },
        prev: { href: String(url) },
        self: { href: String(url) }
      },
      _embedded: {
        records: []
      }
    }
  }

  const collection = await parseJSONResponse<CollectionPage<Frontier.TransactionResponse>>(response)

  removeStaleOptimisticUpdates(
    frontierURL,
    collection._embedded.records.map(record => record.hash)
  )
  return collection
}

export async function fetchAccountOpenOrders(
  frontierURLs: string[],
  accountID: string,
  options: PaginationOptions = {}
) {
  const frontierURL = getRandomURL(frontierURLs)
  const fetchQueue = getFetchQueue(frontierURL)
  const url = new URL(`/accounts/${accountID}/offers?${qs.stringify({ ...identification, ...options })}`, frontierURL)

  const response = await fetchQueue.add(() => fetch(String(url)), { priority: 1 })

  return parseJSONResponse<CollectionPage<ServerApi.OfferRecord>>(response)
}

export async function fetchFeeStats(frontierURL: string): Promise<FeeStats> {
  const fetchQueue = getFetchQueue(frontierURL)
  const url = new URL("/fee_stats", frontierURL)

  const response = await fetchQueue.add(() => fetch(url.toString()), {
    priority: 10
  })

  if (!response.ok) {
    throw CustomError("RequestFailedError", `Request to ${url} failed with status code ${response.status}`, {
      target: url.toString(),
      status: response.status
    })
  }
  return response.json()
}

export async function fetchOrderbookRecord(frontierURLs: string[], sellingAsset: string, buyingAsset: string) {
  if (buyingAsset === sellingAsset) {
    return createEmptyOrderbookRecord(parseAssetID(buyingAsset), parseAssetID(buyingAsset))
  }
  const frontierURL = getRandomURL(frontierURLs)
  const fetchQueue = getFetchQueue(frontierURL)
  const query = createOrderbookQuery(parseAssetID(sellingAsset), parseAssetID(buyingAsset))
  const url = new URL(`/order_book?${qs.stringify({ ...identification, ...query })}`, frontierURL)

  const response = await fetchQueue.add(() => fetch(String(url)), { priority: 1 })
  return parseJSONResponse<ServerApi.OrderbookRecord>(response)
}

export async function fetchTimebounds(frontierURL: string, timeout: number) {
  const fetchQueue = getFetchQueue(frontierURL)
  const frontier = new Server(frontierURL)

  return fetchQueue.add(() => frontier.fetchTimebounds(timeout), {
    priority: 10
  })
}
