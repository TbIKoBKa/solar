/* tslint:disable:no-string-literal */

import React from "react"
import { Asset, Networks, Server, Transaction, Frontier } from "xdb-digitalbits-sdk"
import {
  SigningKeyCacheContext,
  DigitalBitsAddressCacheContext,
  DigitalBitsAddressReverseCacheContext,
  WebAuthTokenCacheContext
} from "~App/contexts/caches"
import { DigitalBitsContext } from "~App/contexts/digitalbits"
import { workers } from "~Workers/worker-controller"
import { DigitalBitsToml, DigitalBitsTomlCurrency } from "~shared/types/digitalbits-toml"
import { createEmptyAccountData, AccountData, BalanceLine } from "../lib/account"
import { createPersistentCache } from "../lib/persistent-cache"
import * as DigitalBitsAddresses from "../lib/digitalbits-address"
import { mapSuspendables } from "../lib/suspense"
import { accountDataCache, accountHomeDomainCache, digitalbitsTomlCache } from "./_caches"
import { useNetWorker } from "./workers"

/** @deprecated */
export function useFrontier(testnet: boolean = false) {
  const frontierURLs = useFrontierURLs(testnet)
  const frontierURL = frontierURLs[0]

  return testnet ? new Server(frontierURL) : new Server(frontierURL)
}

export function useFrontierURLs(testnet: boolean = false) {
  const digitalbits = React.useContext(DigitalBitsContext)

  if (digitalbits.isSelectionPending) {
    throw digitalbits.pendingSelection
  }

  const frontierURLs = testnet ? digitalbits.testnetFrontierURLs : digitalbits.pubnetFrontierURLs
  return frontierURLs
}

export function useFederationLookup() {
  const lookup = React.useContext(DigitalBitsAddressCacheContext)
  const reverseLookup = React.useContext(DigitalBitsAddressReverseCacheContext)
  return {
    lookupFederationRecord(digitalbitsAddress: string) {
      return DigitalBitsAddresses.lookupFederationRecord(digitalbitsAddress, lookup.cache, reverseLookup.cache)
    },
    lookupDigitalBitsAddress(publicKey: string) {
      return reverseLookup.cache.get(publicKey)
    }
  }
}

export function useWebAuth() {
  const signingKeys = React.useContext(SigningKeyCacheContext)
  const webauthTokens = React.useContext(WebAuthTokenCacheContext)
  const createCacheKey = React.useCallback(
    (endpointURL: string, localPublicKey: string) => `${endpointURL}:${localPublicKey}`,
    []
  )

  return {
    async fetchChallenge(
      endpointURL: string,
      serviceSigningKey: string | null,
      localPublicKey: string,
      network: Networks
    ) {
      const { netWorker } = await workers
      const challenge = await netWorker.fetchWebAuthChallenge(endpointURL, serviceSigningKey, localPublicKey, network)
      return new Transaction(challenge, network)
    },

    async fetchWebAuthData(frontierURL: string, issuerAccountID: string) {
      const { netWorker } = await workers
      const metadata = await netWorker.fetchWebAuthData(frontierURL, issuerAccountID)
      if (metadata && metadata.signingKey) {
        signingKeys.store(metadata.signingKey, metadata.domain)
      }
      return metadata
    },

    getCachedAuthToken(endpointURL: string, localPublicKey: string) {
      return webauthTokens.cache.get(createCacheKey(endpointURL, localPublicKey))
    },

    async postResponse(endpointURL: string, transaction: Transaction, testnet: boolean) {
      const { netWorker } = await workers
      const manageDataOperation = transaction.operations.find(operation => operation.type === "manageData")
      const localPublicKey = manageDataOperation ? manageDataOperation.source : undefined

      const network = testnet ? Networks.TESTNET : Networks.PUBLIC
      const txXdr = transaction
        .toEnvelope()
        .toXDR()
        .toString("base64")

      const { authToken, decoded } = await netWorker.postWebAuthResponse(endpointURL, txXdr, network)

      if (localPublicKey) {
        const maxAge = decoded.exp ? Number.parseInt(decoded.exp, 10) * 1000 - Date.now() - 60_000 : undefined
        webauthTokens.store(createCacheKey(endpointURL, localPublicKey), authToken, maxAge)
      }
      return authToken
    }
  }
}

const digitalbitsTomlPersistentCache = createPersistentCache<DigitalBitsToml>("digitalbits.toml", {
  expiresIn: 24 * 60 * 60_000,
  maxItems: 50
})

export function useDigitalBitsToml(domain: string | undefined): DigitalBitsToml | undefined {
  if (!domain) {
    return undefined
  }

  const fetchDigitalBitsTomlData = async (): Promise<[true, any]> => {
    const { netWorker } = await workers
    const digitalbitsTomlData = await netWorker.fetchDigitalBitsToml(domain)

    digitalbitsTomlPersistentCache.save(domain, digitalbitsTomlData || null)
    return [true, digitalbitsTomlData]
  }

  const cached = digitalbitsTomlCache.get(domain)

  if (cached && cached[0]) {
    return cached[1]
  }

  return digitalbitsTomlPersistentCache.read(domain) || digitalbitsTomlCache.suspend(domain, fetchDigitalBitsTomlData)
}

export function useAccountData(accountID: string, testnet: boolean) {
  const frontierURLs = useFrontierURLs(testnet)
  const netWorker = useNetWorker()

  const selector = [frontierURLs, accountID] as const
  const cached = accountDataCache.get(selector)

  const prepare = (account: Frontier.AccountResponse | null): AccountData =>
    account
      ? {
          ...account,
          balances: account.balances.filter(
            (balance): balance is BalanceLine => balance.asset_type !== "liquidity_pool_shares"
          ),
          data_attr: account.data
        }
      : createEmptyAccountData(accountID)

  if (!cached) {
    accountDataCache.suspend(selector, () => netWorker.fetchAccountData(frontierURLs, accountID).then(prepare))
  }
  return cached || createEmptyAccountData(accountID)
}

const homeDomainCachePubnet = createPersistentCache<string>("home_domain:pubnet", { expiresIn: 24 * 60 * 60_000 })
const homeDomainCacheTestnet = createPersistentCache<string>("home_domain:testnet", { expiresIn: 24 * 60 * 60_000 })

export function useAccountHomeDomains(
  accountIDs: string[],
  testnet: boolean,
  allowIncompleteResult?: boolean
): Array<string | undefined> {
  const frontierURLs = useFrontierURLs(testnet)
  const netWorker = useNetWorker()
  const [, setRerenderCounter] = React.useState(0)

  const forceRerender = () => setRerenderCounter(counter => counter + 1)

  const fetchHomeDomain = async (accountID: string): Promise<[string] | []> => {
    const accountData = await netWorker.fetchAccountData(frontierURLs, accountID)
    const homeDomain = accountData ? (accountData as any).home_domain : undefined
    if (homeDomain) {
      ;(testnet ? homeDomainCacheTestnet : homeDomainCachePubnet).save(accountID, homeDomain || null)
    }
    if (allowIncompleteResult) {
      forceRerender()
    }
    return homeDomain ? [homeDomain] : []
  }

  try {
    return mapSuspendables(accountIDs, accountID => {
      const selector = [frontierURLs, accountID] as const
      return (accountHomeDomainCache.get(selector) ||
        accountHomeDomainCache.suspend(selector, () => fetchHomeDomain(accountID)))[0]
    })
  } catch (thrown) {
    if (allowIncompleteResult && thrown && typeof thrown.then === "function") {
      const persistentlyCached = accountIDs.map(accountID =>
        (testnet ? homeDomainCacheTestnet : homeDomainCachePubnet).read(accountID)
      )

      if (persistentlyCached.every(element => typeof element === "string" && element)) {
        return persistentlyCached as string[]
      }
    }
    throw thrown
  }
}

export function useAccountHomeDomain(
  accountID: string | undefined,
  testnet: boolean,
  allowIncompleteResult?: boolean
): string | undefined {
  return useAccountHomeDomains(accountID ? [accountID] : [], testnet, allowIncompleteResult)[0]
}

/**
 * Same as `useAccountHomeDomain()`, but additionally checks
 */
export function useAccountHomeDomainSafe(
  accountID: string | undefined,
  testnet: boolean,
  allowIncompleteResult?: boolean
) {
  const homeDomain = useAccountHomeDomain(accountID, testnet, allowIncompleteResult)
  const digitalbitsToml = useDigitalBitsToml(homeDomain)

  const matchesIssuingAccount =
    digitalbitsToml && (digitalbitsToml.CURRENCIES || []).some(currency => currency.issuer === accountID)
  const matchesSigningKey =
    digitalbitsToml &&
    (digitalbitsToml.SIGNING_KEY === accountID || digitalbitsToml.URI_REQUEST_SIGNING_KEY === accountID)

  return homeDomain && (matchesIssuingAccount || matchesSigningKey) ? homeDomain : undefined
}

export function useAssetMetadata(asset: Asset | undefined, testnet: boolean): DigitalBitsTomlCurrency | undefined {
  const assetCode = !asset || asset.isNative() ? undefined : asset.getCode()
  const issuerAccountID = !asset || asset.isNative() ? undefined : asset.getIssuer()
  const homeDomain = useAccountHomeDomain(issuerAccountID, testnet, true)
  const digitalbitsTomlData = useDigitalBitsToml(homeDomain)

  if (digitalbitsTomlData && digitalbitsTomlData["CURRENCIES"] && Array.isArray(digitalbitsTomlData["CURRENCIES"])) {
    const assetMetadata = digitalbitsTomlData["CURRENCIES"].find(
      (currency: any) => currency.code === assetCode && currency.issuer === issuerAccountID
    )
    return assetMetadata
  } else {
    return undefined
  }
}
