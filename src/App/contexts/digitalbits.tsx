import React from "react"
import { useNetworkCacheReset } from "~Generic/hooks/digitalbits-subscriptions"
import { workers } from "~Workers/worker-controller"
import { trackError } from "./notifications"

interface Props {
  children: React.ReactNode
}

interface ContextType {
  isSelectionPending: boolean
  pendingSelection: Promise<any>
  pubnetFrontierURLs: string[]
  testnetFrontierURLs: string[]
}

const initialFrontierSelection: Promise<[string[], string[]]> = (async () => {
  const { netWorker } = await workers

  const pubnetFrontierURLs: string[] = Array.from(
    new Set(
      await Promise.all([
        "https://frontier.livenet.digitalbits.io"
        // netWorker.checkHorizonOrFailover("https://horizon.stellarx.com", "https://horizon.stellar.org"),
        // netWorker.checkHorizonOrFailover("https://horizon.stellar.lobstr.co", "https://horizon.stellar.org")
      ])
    )
  )

  // const testnetFrontierURLs: string[] = ["https://horizon-testnet.stellar.org"]
  const testnetFrontierURLs: string[] = ["https://frontier.testnet.digitalbits.io"]

  return Promise.all([pubnetFrontierURLs, testnetFrontierURLs])
})()

initialFrontierSelection.catch(trackError)

const initialValues: ContextType = {
  isSelectionPending: true,
  pendingSelection: initialFrontierSelection,
  pubnetFrontierURLs: ["https://frontier.livenet.digitalbits.io"],
  testnetFrontierURLs: ["https://frontier.testnet.digitalbits.io/"]
}

// https://horizon.stellar.org
// https://stellar-horizon-testnet.satoshipay.io

const DigitalBitsContext = React.createContext<ContextType>(initialValues)

export function DigitalBitsProvider(props: Props) {
  const [contextValue, setContextValue] = React.useState<ContextType>(initialValues)
  const resetNetworkCaches = useNetworkCacheReset()

  React.useEffect(() => {
    let cancelled = false

    const init = async () => {
      const { netWorker } = await workers

      setContextValue(prevState => ({ ...prevState, pendingSelection: initialFrontierSelection }))
      const [pubnetFrontierURLs, testnetFrontierURLs] = await initialFrontierSelection

      if (!cancelled) {
        setContextValue(prevState => ({
          isSelectionPending: false,
          pendingSelection: prevState.pendingSelection,
          pubnetFrontierURLs:
            pubnetFrontierURLs !== prevState.pubnetFrontierURLs ? pubnetFrontierURLs : prevState.pubnetFrontierURLs,
          testnetFrontierURLs:
            testnetFrontierURLs !== prevState.testnetFrontierURLs ? testnetFrontierURLs : prevState.testnetFrontierURLs
        }))

        if (
          pubnetFrontierURLs !== initialValues.pubnetFrontierURLs ||
          testnetFrontierURLs !== initialValues.testnetFrontierURLs
        ) {
          await netWorker.resetAllSubscriptions()
          resetNetworkCaches()
        }

        // tslint:disable-next-line no-console
        console.debug(`Selected Frontier servers:`, { pubnetFrontierURLs, testnetFrontierURLs })
      }
    }

    if (navigator.onLine !== false) {
      init().catch(trackError)
    }

    const unsubscribe = () => {
      cancelled = true
    }
    return unsubscribe
  }, [resetNetworkCaches])

  return <DigitalBitsContext.Provider value={contextValue}>{props.children}</DigitalBitsContext.Provider>
}

export { ContextType as DigitalBitsContextType, DigitalBitsContext }
