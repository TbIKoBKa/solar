import React from "react"
import { useTranslation } from "react-i18next"
import DigitalbitDepositOptions from "~DigitalbitPurchase/components/DigitalbitPurchaseOptions"
import { VerticalLayout } from "~Layout/components/Box"
import { DepositContext } from "./DepositProvider"
import { Paragraph, Summary } from "./Sidebar"

interface PurchaseDigitalbitsProps {
  onCloseDialog: () => void
}

function PurchaseDigitalbits(props: PurchaseDigitalbitsProps) {
  const { account } = React.useContext(DepositContext)

  return (
    <VerticalLayout alignItems="center" textAlign="center">
      <DigitalbitDepositOptions account={account} onCloseDialog={props.onCloseDialog} />
    </VerticalLayout>
  )
}

const Sidebar = () => {
  const { t } = useTranslation()
  return (
    <Summary headline={t("transfer-service.purchase-digitalbits.sidebar.headline")}>
      <Paragraph>{t("transfer-service.purchase-digitalbits.sidebar.info.1")}</Paragraph>
      <Paragraph>{t("transfer-service.purchase-digitalbits.sidebar.info.2")}</Paragraph>
    </Summary>
  )
}
const PurchaseDigitalbitsView = Object.assign(React.memo(PurchaseDigitalbits), { Sidebar })

export default PurchaseDigitalbitsView
