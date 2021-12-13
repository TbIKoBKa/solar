import React from "react"
import { useTranslation } from "react-i18next"
import { Account } from "~App/contexts/accounts"
import MainTitle from "~Generic/components/MainTitle"
import DialogBody from "~Layout/components/DialogBody"
import DigitalbitPurchaseOptions from "./DigitalbitPurchaseOptions"

interface Props {
  account: Account
  onClose: () => void
}

function DigitalbitPurchaseDialog(props: Props) {
  const { t } = useTranslation()
  return (
    <DialogBody top={<MainTitle onBack={props.onClose} title={t("account.purchase-digitalbits.title")} />}>
      <DigitalbitPurchaseOptions account={props.account} onCloseDialog={props.onClose} />
    </DialogBody>
  )
}

export default React.memo(DigitalbitPurchaseDialog)
