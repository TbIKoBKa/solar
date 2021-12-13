import LRUCache from "lru-cache"
import { FederationServer } from "xdb-digitalbits-sdk"
import { workers } from "~Workers/worker-controller"
import { CustomError } from "./errors"
import { isNotFoundError } from "./digitalbits"

export const isPublicKey = (str: string) => Boolean(str.match(/^G[A-Z0-9]{55}$/))
export const isMuxedAddress = (str: string) => Boolean(str.match(/^M[A-Z0-9]{68}$/))
export const isDigitalBitsAddress = (str: string) =>
  Boolean(str.match(/^[^\*> \t\n\r]+\*[^\*\.> \t\n\r]+\.[^\*> \t\n\r]+$/))

export async function lookupFederationRecord(
  digitalbitsAddress: string,
  lookupCache: LRUCache<string, FederationServer.Record>,
  reverseLookupCache: LRUCache<string, string>
) {
  const { netWorker } = await workers
  const cached = lookupCache.get(digitalbitsAddress)

  if (cached) {
    return cached
  }

  let resolved: FederationServer.Record
  try {
    resolved = await netWorker.resolveDigitalBitsAddress(digitalbitsAddress)
  } catch (error) {
    if (error && error.request && !error.response) {
      throw CustomError(
        "DigitalBitsAddressRequestFailedError",
        `Request for resolving the digitalbits address failed: ${digitalbitsAddress}`,
        {
          address: digitalbitsAddress
        }
      )
    } else if (isNotFoundError(error)) {
      throw CustomError("DigitalBitsAddressNotFoundError", `DigitalBits address not found: ${digitalbitsAddress}`, {
        address: digitalbitsAddress
      })
    } else {
      throw error
    }
  }
  lookupCache.set(digitalbitsAddress, resolved)
  reverseLookupCache.set(resolved.account_id, digitalbitsAddress)
  return resolved
}
