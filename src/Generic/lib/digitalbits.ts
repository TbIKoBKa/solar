import BigNumber from "big.js"
import fetch from "isomorphic-fetch"

//TODO import { xdr, Asset, Frontier, Keypair, NotFoundError, Server, Transaction, LiquidityPoolAsset, getLiquidityPoolId } from "xdb-digitalbits-sdk"
import { xdr, Asset, Frontier, Keypair, NotFoundError, Server, Transaction } from "xdb-digitalbits-sdk"
import { LiquidityPoolAsset, getLiquidityPoolId } from "stellar-sdk"

import { OfferAsset } from "xdb-digitalbits-sdk/lib/types/offer"
import { AssetRecord } from "../hooks/digitalbits-ecosystem"
import { AccountData, BalanceLine } from "./account"

const MAX_INT64 = "9223372036854775807"

// Used as a fallback if fetching the friendbot href from frontier fails
const XDB_FOUNDATION_FRIENDBOT_HREF = "https://friendbot.testnet.digitalbits.io/{?addr}"

const dedupe = <T>(array: T[]) => Array.from(new Set(array))

// FIXME: Needs to be queried from frontier
export const BASE_RESERVE = 0.5

export const networkPassphrases = {
  mainnet: "Public Global DigitalBits Network ; September 2015",
  testnet: "Test XDB Foundation Network ; September 2015"
}

export function getAllSources(tx: Transaction) {
  return dedupe([
    tx.source,
    ...(tx.operations.map(operation => operation.source).filter(source => Boolean(source)) as string[])
  ])
}

// FIXME: Wait for proper solution in xdb-digitalbits-sdk: <https://github.com/stellar/js-xdb-digitalbits-sdk/pull/403>
export function isNotFoundError(error: any): error is NotFoundError {
  return (
    (error && error instanceof Error && error.message === "Request failed with status code 404") ||
    (error.response && error.response.status === 404)
  )
}

export function balancelineToAsset(balanceline: BalanceLine): Asset {
  return balanceline.asset_type === "native"
    ? Asset.native()
    : new Asset(balanceline.asset_code, balanceline.asset_issuer)
}

/** Reversal of stringifyAsset() */
export function parseAssetID(assetID: string) {
  if (assetID === "XDB") {
    return Asset.native()
  } else {
    const [issuer, code] = assetID.split(":")
    return new Asset(code, issuer)
  }
}

export function getLiquidityPoolIdFromAsset(asset: Pick<LiquidityPoolAsset, "assetA" | "assetB" | "fee">) {
  const poolId = getLiquidityPoolId("constant_product", {
    assetA: asset.assetA,
    assetB: asset.assetB,
    fee: asset.fee
  }).toString("hex")
  return poolId
}

export function stringifyAssetToReadableString(asset: Asset | LiquidityPoolAsset) {
  if (asset instanceof Asset) {
    return asset.isNative() ? "XDB" : asset.getCode()
  } else {
    return `Liquidity Pool '${asset.assetA.code} <-> ${asset.assetB.code}'`
  }
}

export function stringifyAsset(assetOrTrustline: Asset | BalanceLine) {
  if (assetOrTrustline instanceof Asset) {
    const asset: Asset = assetOrTrustline
    return asset.isNative() ? "XDB" : `${asset.getIssuer()}:${asset.getCode()}`
  } else {
    const line: BalanceLine = assetOrTrustline
    return line.asset_type === "native" ? "XDB" : `${line.asset_issuer}:${line.asset_code}`
  }
}

export async function friendbotTopup(frontierURL: string, publicKey: string) {
  const frontierMetadata = await (await fetch(frontierURL)).json()
  const templatedFriendbotHref = frontierMetadata._links.friendbot.href || XDB_FOUNDATION_FRIENDBOT_HREF
  const friendBotHref = templatedFriendbotHref.replace(/\{\?.*/, "")

  const response = await fetch(friendBotHref + `?addr=${publicKey}`)
  return response.json()
}

export function getAccountMinimumBalance(accountData: Pick<AccountData, "subentry_count">) {
  return BigNumber(2) // 2 accounts for base reserve and signer reserve from own account
    .add(accountData.subentry_count)
    .mul(BASE_RESERVE)
}

export function getSpendableBalance(accountMinimumBalance: BigNumber, balanceLine?: BalanceLine) {
  if (balanceLine !== undefined) {
    const fullBalance = BigNumber(balanceLine.balance)
    return balanceLine.asset_type === "native"
      ? fullBalance.minus(accountMinimumBalance).minus(balanceLine.selling_liabilities)
      : fullBalance.minus(balanceLine.selling_liabilities)
  } else {
    return BigNumber(0)
  }
}

export function getAssetsFromBalances(balances: BalanceLine[]) {
  return balances.map(balance =>
    balance.asset_type === "native"
      ? Asset.native()
      : new Asset(
          (balance as Frontier.BalanceLineAsset).asset_code,
          (balance as Frontier.BalanceLineAsset).asset_issuer
        )
  )
}

export function findMatchingBalanceLine(balances: AccountData["balances"], asset: Asset): BalanceLine | undefined {
  return balances.find((balance): balance is BalanceLine => balancelineToAsset(balance).equals(asset))
}

export function getFrontierURL(frontier: Server) {
  return frontier.serverURL.toString()
}

export function isSignedByAnyOf(signature: xdr.DecoratedSignature, publicKeys: string[]) {
  return publicKeys.some(publicKey => signatureMatchesPublicKey(signature, publicKey))
}

export function offerAssetToAsset(offerAsset: OfferAsset) {
  return offerAsset.asset_type === "native"
    ? Asset.native()
    : new Asset(offerAsset.asset_code as string, offerAsset.asset_issuer as string)
}

export function assetRecordToAsset(assetRecord: AssetRecord) {
  return assetRecord.issuer === "native" ? Asset.native() : new Asset(assetRecord.code, assetRecord.issuer)
}

export function signatureMatchesPublicKey(signature: xdr.DecoratedSignature, publicKey: string): boolean {
  const keypair = Keypair.fromPublicKey(publicKey)

  return signature.hint().equals(keypair.signatureHint())
}

export function trustlineLimitEqualsUnlimited(limit: string | number) {
  return String(limit).replace(".", "") === MAX_INT64
}
