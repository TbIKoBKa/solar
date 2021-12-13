import JWT from "jsonwebtoken"
import { Networks, Server, Transaction } from "xdb-digitalbits-sdk"
import * as WebAuth from "@satoshipay/stellar-sep-10"

export async function fetchWebAuthChallenge(
  endpointURL: string,
  serviceSigningKey: string | null,
  localPublicKey: string,
  network: Networks
) {
  const challenge = await WebAuth.fetchChallenge(endpointURL, serviceSigningKey, localPublicKey, network)
  return challenge
    .toEnvelope()
    .toXDR()
    .toString("base64")
}

export async function fetchWebAuthData(frontierURL: string, issuerAccountID: string) {
  const frontier = new Server(frontierURL)
  return WebAuth.fetchWebAuthData(frontier, issuerAccountID)
}

export async function postWebAuthResponse(endpointURL: string, transactionXdrBase64: string, network: Networks) {
  const transaction = new Transaction(transactionXdrBase64, network)
  const authToken = await WebAuth.postResponse(endpointURL, transaction)
  const decoded = JWT.decode(authToken) as any

  return {
    authToken,
    decoded
  }
}
