import React from "react"
import { useAccountHomeDomainSafe } from "../hooks/digitalbits"
import { useWellKnownAccounts } from "../hooks/digitalbits-ecosystem"
import { Address } from "./PublicKey"

interface AccountNameProps {
  publicKey: string
  testnet: boolean
}

export const AccountName = React.memo(function AccountName(props: AccountNameProps) {
  const wellknownAccounts = useWellKnownAccounts(props.testnet)
  const homeDomain = useAccountHomeDomainSafe(props.publicKey, props.testnet, true)
  const record = wellknownAccounts.lookup(props.publicKey)

  if (record && record.domain) {
    return <span style={{ userSelect: "text" }}>{record.domain}</span>
  } else if (homeDomain) {
    return <span style={{ userSelect: "text" }}>{homeDomain}</span>
  } else {
    return <Address address={props.publicKey} testnet={props.testnet} variant="short" />
  }
})
