import { Frontier, Operation, Signer, Transaction } from "xdb-digitalbits-sdk"
import { OptimisticUpdate } from "../../lib/optimistic-updates"

function addSigner(
  frontierURL: string,
  operation: Operation.SetOptions,
  signer: Signer.Ed25519PublicKey,
  transaction: Transaction
): OptimisticUpdate<Frontier.AccountResponse> {
  return {
    apply(prevAccountData) {
      const allOtherSigners = prevAccountData.signers.filter(existing => {
        return existing.key !== signer.ed25519PublicKey
      })
      return {
        ...prevAccountData,
        signers: [
          ...allOtherSigners,
          {
            type: "ed25519_public_key",
            key: signer.ed25519PublicKey,
            weight: signer.weight!
          }
        ]
      }
    },
    effectsAccountID: operation.source || transaction.source,
    frontierURL,
    title: `Add signer ${signer.ed25519PublicKey} (weight ${signer.weight})`,
    transactionHash: transaction.hash().toString("hex")
  }
}

function removeSigner(
  frontierURL: string,
  operation: Operation.SetOptions,
  signer: Signer.Ed25519PublicKey,
  transaction: Transaction
): OptimisticUpdate<Frontier.AccountResponse> {
  return {
    apply(prevAccountData) {
      return {
        ...prevAccountData,
        signers: prevAccountData.signers.filter(
          prevSigner => !(prevSigner.type === "ed25519_public_key" && prevSigner.key === signer.ed25519PublicKey)
        )
      }
    },
    effectsAccountID: operation.source || transaction.source,
    frontierURL,
    title: `Remove signer ${signer.ed25519PublicKey}`,
    transactionHash: transaction.hash().toString("hex")
  }
}

function setMasterWeight(
  frontierURL: string,
  operation: Operation.SetOptions,
  masterWeight: number,
  transaction: Transaction
): OptimisticUpdate<Frontier.AccountResponse> {
  const accountID = operation.source || transaction.source
  return {
    apply(prevAccountData) {
      return {
        ...prevAccountData,
        signers: prevAccountData.signers.map(signer => {
          if (signer.type === "ed25519_public_key" && signer.key === accountID) {
            return {
              ...signer,
              weight: masterWeight
            }
          } else {
            return signer
          }
        })
      }
    },
    effectsAccountID: accountID,
    frontierURL,
    title: `Set master key weight: ${operation.masterWeight}`,
    transactionHash: transaction.hash().toString("hex")
  }
}

function setThresholds(
  frontierURL: string,
  operation: Operation.SetOptions,
  transaction: Transaction
): OptimisticUpdate<Frontier.AccountResponse> {
  return {
    apply(prevAccountData) {
      const thresholds = { ...prevAccountData.thresholds }

      if (operation.lowThreshold !== undefined) {
        thresholds.low_threshold = operation.lowThreshold
      }
      if (operation.medThreshold !== undefined) {
        thresholds.med_threshold = operation.medThreshold
      }
      if (operation.highThreshold !== undefined) {
        thresholds.high_threshold = operation.highThreshold
      }
      return {
        ...prevAccountData,
        thresholds
      }
    },
    effectsAccountID: operation.source || transaction.source,
    frontierURL,
    title: `Set thresholds: ${operation.lowThreshold}/${operation.medThreshold}/${operation.highThreshold}`,
    transactionHash: transaction.hash().toString("hex")
  }
}

function setAccountOptions(
  frontierURL: string,
  operation: Operation.SetOptions,
  transaction: Transaction
): Array<OptimisticUpdate<Frontier.AccountResponse>> {
  const updates: Array<OptimisticUpdate<Frontier.AccountResponse>> = []
  const { signer } = operation

  if (signer && "ed25519PublicKey" in signer && typeof signer.weight === "number" && signer.weight > 0) {
    updates.push(addSigner(frontierURL, operation, signer, transaction))
  } else if (signer && "ed25519PublicKey" in signer && typeof signer.weight === "number" && signer.weight === 0) {
    updates.push(removeSigner(frontierURL, operation, signer, transaction))
  } else if (
    operation.lowThreshold !== undefined ||
    operation.medThreshold !== undefined ||
    operation.highThreshold !== undefined
  ) {
    updates.push(setThresholds(frontierURL, operation, transaction))
  }

  if (operation.masterWeight !== undefined) {
    updates.push(setMasterWeight(frontierURL, operation, operation.masterWeight, transaction))
  }

  return updates
}

export default setAccountOptions
