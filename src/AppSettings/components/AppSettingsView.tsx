import React from "react"
import { useTranslation } from "react-i18next"
import Card from "@material-ui/core/Card"
import CardContent from "@material-ui/core/CardContent"
import Typography from "@material-ui/core/Typography"
import * as routes from "~App/routes"
import AppSettings from "~AppSettings/components/AppSettings"
import { Box, VerticalLayout } from "~Layout/components/Box"
import MainTitle from "~Generic/components/MainTitle"
import { useIsMobile, useRouter } from "~Generic/hooks/userinterface"
import { matchesRoute } from "~Generic/lib/routes"
import { Section } from "~Layout/components/Page"
import { SettingsContext } from "~App/contexts/settings"
import { FormControlLabel, Switch } from "@material-ui/core"
import { AccountsContext } from "~App/contexts/accounts"

// tslint:disable-next-line
const pkg = require("../../../package.json")

function SettingsPage() {
  const isSmallScreen = useIsMobile()
  const router = useRouter()
  const { t } = useTranslation()
  const settings = React.useContext(SettingsContext)
  const { accounts, networkSwitch, toggleNetwork } = React.useContext(AccountsContext)

  const testnetAccounts = React.useMemo(() => accounts.filter(account => account.testnet), [accounts])
  const showSettingsOverview = matchesRoute(router.location.pathname, routes.settings(), true)

  const navigateToAllAccounts = React.useCallback(() => {
    router.history.push(routes.allAccounts())
  }, [router.history])

  const navigateToSettingsOverview = React.useCallback(() => router.history.push(routes.settings()), [router.history])

  const networkSwitchButton = (
    <FormControlLabel
      control={<Switch checked={networkSwitch === "testnet"} color="secondary" onChange={toggleNetwork} />}
      label={t("app.all-accounts.switch.label")}
      style={{ marginRight: 0 }}
    />
  )

  const headerCard = React.useMemo(
    () => (
      <Card
        style={{
          color: "#f0f2f6",
          position: "relative",
          background: "transparent",
          boxShadow: "none"
        }}
      >
        <CardContent
          style={{
            padding: isSmallScreen ? 8 : undefined,
            paddingBottom: 8,
            display: "flex",
            justifyContent: "space-between"
          }}
        >
          <MainTitle
            onBack={showSettingsOverview ? navigateToAllAccounts : navigateToSettingsOverview}
            title={t("app-settings.settings.title")}
            titleColor="inherit"
            style={{ marginTop: -12, marginLeft: 0 }}
          />
          {settings.showTestnet || networkSwitch === "testnet" || testnetAccounts.length > 0
            ? networkSwitchButton
            : null}
        </CardContent>
      </Card>
    ),
    [
      isSmallScreen,
      navigateToAllAccounts,
      navigateToSettingsOverview,
      networkSwitch,
      networkSwitchButton,
      settings.showTestnet,
      showSettingsOverview,
      t,
      testnetAccounts.length
    ]
  )

  return (
    <VerticalLayout height="100%">
      <Section top brandColored grow={0} shrink={0}>
        {headerCard}
      </Section>
      <Section
        bottom={isSmallScreen}
        style={{
          backgroundColor: "#f0f2f6",
          height: "100%",
          flexGrow: 1,
          flexShrink: 1,
          padding: isSmallScreen ? undefined : "0 24px",
          overflowY: "auto"
        }}
      >
        <VerticalLayout height="100%" grow>
          <Box grow overflowY="auto">
            <AppSettings />
          </Box>
          <Box grow={0} margin="16px 0">
            <Typography align="center" color="textSecondary">
              v{pkg.version}
            </Typography>
          </Box>
        </VerticalLayout>
      </Section>
    </VerticalLayout>
  )
}

export default SettingsPage
