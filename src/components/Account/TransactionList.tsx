import React from "react"
import ListSubheader from "@material-ui/core/ListSubheader"
import HumanTime from "react-human-time"
import ArrowLeftIcon from "react-icons/lib/fa/arrow-left"
import ArrowRightIcon from "react-icons/lib/fa/arrow-right"
import CogIcon from "react-icons/lib/fa/cog"
import ExchangeIcon from "react-icons/lib/fa/exchange"
import { Operation, Transaction } from "stellar-sdk"
import { getPaymentSummary, PaymentSummary } from "../../lib/paymentSummary"
import { formatOperationType, selectNetwork } from "../../lib/transaction"
import { List, ListItem } from "../List"

type TransactionWithUndocumentedProps = Transaction & {
  created_at: string
}

const TransactionIcon = (props: { paymentSummary: PaymentSummary }) => {
  if (props.paymentSummary.length === 0) {
    return <CogIcon />
  } else if (props.paymentSummary.every(summaryItem => summaryItem.balanceChange.gt(0))) {
    return <ArrowLeftIcon />
  } else if (props.paymentSummary.every(summaryItem => summaryItem.balanceChange.lt(0))) {
    return <ArrowRightIcon />
  } else {
    return <ExchangeIcon />
  }
}

const DetailedInfo = (props: { children: React.ReactNode }) => {
  return <small style={{ opacity: 0.8, fontSize: "75%" }}>{props.children}</small>
}

const RemotePublicKeys = (props: { publicKeys: string[] }) => {
  if (props.publicKeys.length === 0) {
    return <>-</>
  } else if (props.publicKeys.length === 1) {
    return <>{props.publicKeys[0]}</>
  } else {
    return (
      <>
        {props.publicKeys[0]} <i>+ {props.publicKeys.length - 1} more</i>
      </>
    )
  }
}

const TitleText = (props: { paymentSummary: PaymentSummary; transaction: Transaction }) => {
  const balanceChanges = props.paymentSummary.map(
    ({ asset, balanceChange }) => `${asset.getCode()} ${balanceChange.abs().toString()}`
  )
  const remotePublicKeys = props.paymentSummary.reduce(
    (pubKeys, summaryItem) => pubKeys.concat(summaryItem.publicKeys),
    [] as string[]
  )

  if (remotePublicKeys.length > 0 && props.paymentSummary.every(summaryItem => summaryItem.balanceChange.gt(0))) {
    return (
      <span>
        Received {balanceChanges.join(", ")}
        &nbsp;
        <DetailedInfo>
          from <RemotePublicKeys publicKeys={remotePublicKeys} />
        </DetailedInfo>
      </span>
    )
  } else if (
    remotePublicKeys.length > 0 &&
    props.paymentSummary.every(summaryItem => summaryItem.balanceChange.lt(0))
  ) {
    return (
      <span>
        Sent {balanceChanges.join(", ")}{" "}
        <DetailedInfo>
          to <RemotePublicKeys publicKeys={remotePublicKeys} />
        </DetailedInfo>
      </span>
    )
  } else if (props.transaction.operations.length === 1 && props.transaction.operations[0].type === "changeTrust") {
    const operation = props.transaction.operations[0] as Operation.ChangeTrust

    return String(operation.limit) === "0" ? (
      <>Removed trust in asset {operation.line.code}</>
    ) : (
      <>Trust asset {operation.line.code}</>
    )
  } else {
    return <>{props.transaction.operations.map(operation => formatOperationType(operation.type)).join(", ")}</>
  }
}

const TransactionListItem = (props: { accountPublicKey: string; transaction: Transaction }) => {
  const { accountPublicKey, transaction } = props

  const createdAt = new Date((transaction as TransactionWithUndocumentedProps).created_at)
  const paymentSummary = getPaymentSummary(accountPublicKey, transaction)

  return (
    <ListItem
      leftIcon={
        <span style={{ fontSize: "125%" }}>
          <TransactionIcon paymentSummary={paymentSummary} />
        </span>
      }
      heading={
        <small style={{ color: "#666", fontSize: "80%" }}>
          <HumanTime time={createdAt.getTime()} />
        </small>
      }
      primaryText={
        <div style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
          <TitleText paymentSummary={paymentSummary} transaction={transaction} />
        </div>
      }
    />
  )
}

const TransactionList = (props: {
  accountPublicKey: string
  testnet: boolean
  title: React.ReactNode
  transactions: Transaction[]
}) => {
  // Need to select the right network, because `transaction.hash()` will fail if no network was selected
  selectNetwork(props.testnet)

  return (
    <List>
      <ListSubheader style={{ background: "rgba(255, 255, 255, 0.8)" }}>{props.title}</ListSubheader>
      {props.transactions.map(transaction => (
        <TransactionListItem
          key={transaction.hash().toString("hex")}
          accountPublicKey={props.accountPublicKey}
          transaction={transaction}
        />
      ))}
    </List>
  )
}

export default TransactionList