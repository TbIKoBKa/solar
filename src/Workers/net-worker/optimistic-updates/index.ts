import { Frontier, Operation, ServerApi, Transaction } from "xdb-digitalbits-sdk"
import {
  accountDataUpdates,
  offerUpdates,
  OptimisticAccountUpdate,
  OptimisticOfferUpdate
} from "../../lib/optimistic-updates"
import handleChangeTrust from "./change-trust"
import handleManageOffer from "./manage-offer"
import handleSetOptions from "./set-options"

export { accountDataUpdates, offerUpdates, OptimisticAccountUpdate, OptimisticOfferUpdate }

function ingestOperation(frontierURL: string, operation: Operation, transaction: Transaction) {
  if (operation.type === "changeTrust") {
    accountDataUpdates.addUpdates(handleChangeTrust(frontierURL, operation, transaction))
  } else if (operation.type === "setOptions") {
    accountDataUpdates.addUpdates(handleSetOptions(frontierURL, operation, transaction))
  } else if (operation.type === "manageBuyOffer" || operation.type === "manageSellOffer") {
    offerUpdates.addUpdates(handleManageOffer(frontierURL, operation, transaction))
  }
}

export function handleSubmittedTransaction(frontierURL: string, transaction: Transaction) {
  for (const operation of transaction.operations) {
    ingestOperation(frontierURL, operation, transaction)
  }
}

export function optimisticallyUpdateAccountData(
  frontierURL: string,
  accountData: Frontier.AccountResponse
): Frontier.AccountResponse {
  const optimisticUpdates = accountDataUpdates.getUpdates(frontierURL, accountData.account_id)
  return optimisticUpdates.reduce((updatedAccountData, update) => update.apply(updatedAccountData), accountData)
}

export function optimisticallyUpdateOffers(
  frontierURL: string,
  accountID: string,
  openOffers: ServerApi.OfferRecord[]
): ServerApi.OfferRecord[] {
  const optimisticUpdates = offerUpdates.getUpdates(frontierURL, accountID)
  const updated = optimisticUpdates.reduce((updatedOffers, update) => update.apply(updatedOffers), openOffers)
  return updated
}

export function removeStaleOptimisticUpdates(frontierURL: string, latestTransactionHashs: string[]) {
  accountDataUpdates.removeStaleUpdates(frontierURL, latestTransactionHashs)
  offerUpdates.removeStaleUpdates(frontierURL, latestTransactionHashs)
}
