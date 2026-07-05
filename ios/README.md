# Intella — iOS + Apple Watch

A minimal iOS app with a companion Apple Watch app, used to verify that the app
runs on a physical iPhone and Apple Watch before building real features.

- **iOS app** — black screen with the Intella logo centered.
- **watchOS app** — black screen with the Intella logo centered.
- **watchOS widget** — a small circular accessory widget (complication) showing
  the logo. Tapping it opens the watch app.

## Project generation

The Xcode project is **generated** from [`project.yml`](project.yml) with
[XcodeGen](https://github.com/yonaskolb/XcodeGen) and is not committed. Regenerate
it whenever `project.yml` or the file layout changes:

```sh
brew install xcodegen   # if needed
cd ios
xcodegen generate
open Intella.xcodeproj
```

## Targets

| Target               | Platform | Bundle ID                                        |
| -------------------- | -------- | ------------------------------------------------ |
| `Intella`            | iOS      | `com.michaelfocacci.intella`                     |
| `IntellaWatch`       | watchOS  | `com.michaelfocacci.intella.watchkitapp`         |
| `IntellaWatchWidget` | watchOS  | `com.michaelfocacci.intella.watchkitapp.widget`  |

The watch app is embedded in the iOS app; the widget extension is embedded in the
watch app. Building the `Intella` scheme builds and packages all three.

Deployment targets: iOS 18.0 / watchOS 11.0. Signing team is preset to
`7R3SX9X3V2` with automatic signing.

## Running on your devices

1. `cd ios && xcodegen generate && open Intella.xcodeproj`
2. Select the **Intella** scheme and your iPhone as the run destination, then Run
   (⌘R). With the watch paired, Xcode installs the watch app too. (You can also
   select the **IntellaWatch** scheme + your watch to install directly.)
3. On first launch you may need to trust the developer profile on each device:
   Settings → General → VPN & Device Management.
4. Add the widget on the watch: long-press a watch face → **Edit** → add the
   **Intella** circular complication, or add it to the Smart Stack.

## Assets

App icon and in-app logo are generated from `Intella-App-Icon.jpeg` at the repo
root (see the `Assets.xcassets` folders in each target).
