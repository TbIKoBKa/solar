import React from "react"
import { Asset } from "xdb-digitalbits-sdk"
import Avatar from "@material-ui/core/Avatar"
import makeStyles from "@material-ui/core/styles/makeStyles"
import { useAssetMetadata } from "~Generic/hooks/digitalbits"
import { brandColor } from "~App/theme"
import DigitalbitIcon from "~Icons/components/Digitalbit"

const paddedAssetIconsRegex = /bitbondsto\.com/

const useAssetLogoStyles = makeStyles({
  imageAvatar: {
    backgroundColor: "#f0f2f6"
  },
  textAvatar: {
    background: `linear-gradient(145deg, ${brandColor.main} 0%, ${brandColor.dark} 35%, ${brandColor.dark} 75%, ${brandColor.main} 100%)`,
    border: "1px solid rgba(255, 255, 255, 0.66)",
    color: "rgba(255, 255, 255, 1)",
    fontSize: 12,
    fontWeight: 500
  },
  longCodeTextAvatar: {
    justifyContent: "flex-start",
    padding: "0 2px"
  },
  darkTextAvatar: {
    background: brandColor.dark,
    border: `1px solid ${brandColor.main15}`
  },
  xdbAvatar: {
    background: "#f0f2f6",
    boxSizing: "border-box",
    color: "black",
    fontSize: 12,
    padding: "0.5em"
  },
  icon: {
    width: "100%",
    height: "100%"
  },
  padding: {
    width: "75%",
    height: "75%"
  }
})

interface AssetLogoProps {
  asset: Asset
  className?: string
  dark?: boolean
  imageURL?: string
  style?: React.CSSProperties
}

function AssetLogo(props: AssetLogoProps) {
  const className = props.className || ""
  const classes = useAssetLogoStyles()

  if (props.asset.isNative()) {
    return (
      <Avatar alt="Digitalbits (XDB)" className={`${className} ${classes.xdbAvatar}`} style={props.style}>
        <DigitalbitIcon className={classes.icon} />
      </Avatar>
    )
  } else {
    const applyPadding = props.imageURL && props.imageURL.match(paddedAssetIconsRegex)
    const assetCode =
      props.asset.code.length < 5 ? props.asset.code : props.asset.code.substr(0, 2) + props.asset.code.substr(-2)

    const avatarClassName = [
      className,
      props.imageURL ? classes.imageAvatar : classes.textAvatar,
      props.dark && !props.imageURL ? classes.darkTextAvatar : ""
    ].join(" ")
    const iconClassName = [classes.icon, applyPadding ? classes.padding : ""].join(" ")
    return (
      <Avatar alt={name} className={avatarClassName} style={props.style}>
        {props.imageURL ? <img className={iconClassName} src={props.imageURL} /> : assetCode}
      </Avatar>
    )
  }
}

interface SuspendingAssetLogoProps {
  asset: Asset
  className?: string
  dark?: boolean
  style?: React.CSSProperties
  testnet: boolean
}

function SuspendingAssetLogo(props: SuspendingAssetLogoProps) {
  const metadata = useAssetMetadata(props.asset, props.testnet)
  return <AssetLogo {...props} imageURL={metadata ? metadata.image : undefined} />
}

function AssetLogoWithFallback(props: SuspendingAssetLogoProps) {
  return (
    <React.Suspense fallback={<AssetLogo {...props} />}>
      <SuspendingAssetLogo {...props} />
    </React.Suspense>
  )
}

export default React.memo(AssetLogoWithFallback)
