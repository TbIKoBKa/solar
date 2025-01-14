export async function isBiometricAuthAvailable() {
  return new Promise<BiometricAvailability>(resolve => {
    Fingerprint.isAvailable(
      () => {
        resolve({ available: true, enrolled: true })
      },
      error => {
        // code -106 means 'BIOMETRIC_NOT_ENROLLED' (cordova fingerprint plugin)
        // hence biometric auth is available but not currently set up
        if (error.code === -106) {
          resolve({ available: true, enrolled: false })
        } else {
          resolve({ available: false, enrolled: false })
        }
      }
    )
  })
}

export async function bioAuthenticate() {
  return new Promise((resolve, reject) => {
    Fingerprint.show(
      {
        title: "Unlock AstraX",
        description: device && device.platform === "iOS" ? "Unlock your AstraX wallet" : undefined
      },
      resolve,
      reject
    )
  })
}
