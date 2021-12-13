import BigNumber from "big.js"

//TODO import { Asset, Frontier, LiquidityPoolAsset, Operation, Transaction } from "xdb-digitalbits-sdk"
import { Frontier } from "xdb-digitalbits-sdk"
import { Asset, LiquidityPoolAsset, Operation, Transaction } from "stellar-base"

import {
  balancelineToAsset,
  getLiquidityPoolIdFromAsset,
  stringifyAssetToReadableString
} from "~Generic/lib/digitalbits"
import { OptimisticAccountUpdate } from "../../lib/optimistic-updates"

function addTrustline(
  frontierURL: string,
  operation: Operation.ChangeTrust,
  transaction: Transaction
): OptimisticAccountUpdate {
  return {
    apply(prevAccountData) {
      const newBalance: Frontier.BalanceLineAsset | Frontier.BalanceLineLiquidityPool =
        operation.line.getAssetType() === "liquidity_pool_shares"
          ? {
              asset_type: "liquidity_pool_shares",
              balance: "0",
              is_authorized: false,
              is_authorized_to_maintain_liabilities: false,
              is_clawback_enabled: false,
              last_modified_ledger: 0,
              limit: operation.limit,
              liquidity_pool_id: getLiquidityPoolIdFromAsset(operation.line as LiquidityPoolAsset)
            }
          : {
              asset_code: (operation.line as Asset).code,
              asset_issuer: (operation.line as Asset).issuer,
              asset_type: "credit_alphanum12",
              balance: "0",
              buying_liabilities: "0",
              is_authorized: false,
              is_authorized_to_maintain_liabilities: false,
              last_modified_ledger: 0,
              limit: operation.limit,
              selling_liabilities: "0",
              is_clawback_enabled: false
            }
      return {
        ...prevAccountData,
        balances: prevAccountData.balances.some(balance => {
          if (
            balance.asset_type === "liquidity_pool_shares" &&
            operation.line.getAssetType() === "liquidity_pool_shares"
          ) {
            const poolId = getLiquidityPoolIdFromAsset(operation.line as LiquidityPoolAsset)
            return balance.liquidity_pool_id === poolId
          } else if (
            balance.asset_type !== "liquidity_pool_shares" &&
            operation.line.getAssetType() !== "liquidity_pool_shares"
          ) {
            const asset: Asset = operation.line as Asset
            return balancelineToAsset(balance).equals(asset)
          } else {
            return false
          }
        })
          ? prevAccountData.balances
          : [...prevAccountData.balances, newBalance]
      }
    },
    effectsAccountID: operation.source || transaction.source,
    frontierURL,
    title: `Remove trustline for ${stringifyAssetToReadableString(operation.line)}`,
    transactionHash: transaction.hash().toString("hex")
  }
}

function removeTrustline(
  frontierURL: string,
  operation: Operation.ChangeTrust,
  transaction: Transaction
): OptimisticAccountUpdate {
  return {
    apply(prevAccountData) {
      return {
        ...prevAccountData,
        balances: prevAccountData.balances.filter(balance => {
          if (
            balance.asset_type === "liquidity_pool_shares" &&
            operation.line.getAssetType() === "liquidity_pool_shares"
          ) {
            const poolId = getLiquidityPoolIdFromAsset(operation.line as LiquidityPoolAsset)
            return balance.liquidity_pool_id !== poolId
          } else if (
            balance.asset_type !== "liquidity_pool_shares" &&
            operation.line.getAssetType() !== "liquidity_pool_shares"
          ) {
            const asset: Asset = operation.line as Asset
            return !balancelineToAsset(balance).equals(asset)
          } else {
            return false
          }
        })
      }
    },
    effectsAccountID: operation.source || transaction.source,
    frontierURL,
    title: `Remove trustline for ${stringifyAssetToReadableString(operation.line)}`,
    transactionHash: transaction.hash().toString("hex")
  }
}

function changeTrust(
  frontierURL: string,
  operation: Operation.ChangeTrust,
  transaction: Transaction
): OptimisticAccountUpdate[] {
  if (BigNumber(operation.limit).eq(0)) {
    return [removeTrustline(frontierURL, operation, transaction)]
  } else {
    return [addTrustline(frontierURL, operation, transaction)]
  }
}

export default changeTrust
