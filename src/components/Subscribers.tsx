/**
 * This file contains reactive components that subscribe to data (like an account balance) and
 * re-render their contents whenever the data changes.
 *
 * These components do not render any UI by themselves. Wrap your representational components in
 * them to obtain some data and receive live updates.
 */

import React from 'react'
import { Server, Transaction } from 'stellar-sdk'
import { observer } from 'mobx-react'
import { subscribeToAccount, subscribeToRecentTxs, AccountObservable } from '../lib/subscriptions'
import { withHorizon } from '../hocs'

interface HorizonProps {
  horizonLivenet: Server,
  horizonTestnet: Server
}

type HorizonRenderProp = (horizon: Server) => React.ReactElement<any>

/**
 * @example
 * <Horizon testnet={false}>
 *   {horizon => (
 *     <div>Currently used horizon server: {horizon.serverURL}</div>
 *   )}
 * </Horizon>
 */
const Horizon = withHorizon<{ children: HorizonRenderProp, testnet: boolean }>(
  (props: { children: HorizonRenderProp, horizonLivenet: Server, horizonTestnet: Server, testnet: boolean }) => {
    const horizon = props.testnet ? props.horizonTestnet : props.horizonLivenet
    return props.children(horizon)
  }
)

type AccountDataRenderProp = (accountData: AccountObservable) => React.ReactElement<any>

const AccountData = withHorizon((props: HorizonProps & { children: AccountDataRenderProp, publicKey: string, testnet: boolean }) => {
  const AccountDataObserver = observer<React.StatelessComponent<{ accountData: AccountObservable }>>(
    (subProps) => props.children(subProps.accountData)
  )
  return (
    <Horizon testnet={props.testnet}>
      {(horizon: Server) => <AccountDataObserver accountData={subscribeToAccount(horizon, props.publicKey)} />}
    </Horizon>
  )
})

const getBalance = (accountData: AccountObservable): number => {
  const balanceUnknown = -1
  const balanceObject = accountData.balances.find(balance => balance.asset_type === 'native')
  return balanceObject ? parseFloat(balanceObject.balance) : balanceUnknown
}

/**
 * @example
 * <Balance publicKey='GBPBFWVBADSESGADWEGC7SGTHE3535FWK4BS6UW3WMHX26PHGIH5NF4W' testnet>
 *   {balance => (
 *     <div>Current balance: XLM {balance}</div>
 *   )}
 * </Balance>
 */
export const Balance = (props: { children: (balance: number) => React.ReactElement<any>, publicKey: string, testnet: boolean }) => {
  return (
    <AccountData publicKey={props.publicKey} testnet={props.testnet}>
      {accountData => props.children(getBalance(accountData))}
    </AccountData>
  )
}

type TransactionsRenderProp = (data: { loading: boolean, transactions: Transaction[] }) => React.ReactElement<any>

/**
 * @example
 * <Transactions publicKey='GBPBFWVBADSESGADWEGC7SGTHE3535FWK4BS6UW3WMHX26PHGIH5NF4W' testnet>
 *   {({ loading, transactions }) => transactions.map(
 *     tx => <TransactionSummary key={tx.hash().toString('hex')} tx={tx} />
 *   )}
 * </Transactions>
 */
export const Transactions = (props: { children: TransactionsRenderProp, publicKey: string, testnet: boolean }) => {
  return (
    <Horizon testnet={props.testnet}>
      {horizon => {
        const recentTxs = subscribeToRecentTxs(horizon, props.publicKey)
        const RecentTxsObserver = observer<React.StatelessComponent<{ recentTransactions: typeof recentTxs }>>(
          ({ recentTransactions }) => {
            // Had a weird issue with mobx: Didn't properly update when just passing down `recentTransactions`; destructuring solves the issue
            return props.children({ loading: recentTransactions.loading, transactions: recentTransactions.transactions })
          }
        )

        return <RecentTxsObserver recentTransactions={recentTxs} />
      }}
    </Horizon>
  )
}