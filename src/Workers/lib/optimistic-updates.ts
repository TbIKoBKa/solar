// tslint:disable member-ordering
import { Observable, Subject } from "observable-fns"
import { Frontier, ServerApi } from "xdb-digitalbits-sdk"

export interface OptimisticUpdate<T> {
  apply(base: T): T
  effectsAccountID: string
  frontierURL: string
  title: string
  transactionHash: string
}

export type OptimisticAccountUpdate = OptimisticUpdate<Frontier.AccountResponse & { home_domain?: string }>
export type OptimisticOfferUpdate = OptimisticUpdate<ServerApi.OfferRecord[]>

const createAccountCacheKeyByFilter = (frontierURL: string, accountID: string) => `${frontierURL}/accounts/${accountID}`
const createAccountCacheKey = (update: OptimisticAccountUpdate) =>
  createAccountCacheKeyByFilter(update.frontierURL, update.effectsAccountID)

const createOfferCacheKeyByFilter = createAccountCacheKeyByFilter
const createOfferCacheKey = (update: OptimisticOfferUpdate) =>
  createOfferCacheKeyByFilter(update.frontierURL, update.effectsAccountID)

function OptimisticUpdateCache<Update extends OptimisticUpdate<any>, FilterArgs extends any[]>(
  createCacheKey: (update: Update) => string,
  createCacheKeyByFilter: (...filterArgs: FilterArgs) => string
) {
  const subject = new Subject<Update>()
  const updates = new Map<string, Update[]>()

  return {
    addUpdates(optimisticUpdates: Update[]) {
      for (const optimisticUpdate of optimisticUpdates) {
        const selector = createCacheKey(optimisticUpdate)
        const prevUpdates = updates.get(selector) || []

        updates.set(selector, [...prevUpdates, optimisticUpdate])
        subject.next(optimisticUpdate)
      }
    },
    getUpdates(...args: FilterArgs) {
      const selector = createCacheKeyByFilter(...args)
      return updates.get(selector) || []
    },
    observe() {
      return Observable.from(subject)
    },
    removeStaleUpdates(frontierURL: string, latestTransactionHashs: string[]) {
      for (const selector of updates.keys()) {
        const prevOptimisticUpdates = updates.get(selector)!
        const nextOptimisticUpdates = prevOptimisticUpdates.filter(
          optUpdate =>
            !(optUpdate.frontierURL === frontierURL && latestTransactionHashs.indexOf(optUpdate.transactionHash) > -1)
        )

        if (nextOptimisticUpdates.length !== prevOptimisticUpdates.length) {
          updates.set(selector, nextOptimisticUpdates)
        }
      }
    },
    updates
  }
}

export const accountDataUpdates = OptimisticUpdateCache(createAccountCacheKey, createAccountCacheKeyByFilter)
export const offerUpdates = OptimisticUpdateCache(createOfferCacheKey, createOfferCacheKeyByFilter)
