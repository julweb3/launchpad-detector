# Launchpad Detector Solana - Browser Extension

This Chrome/Firefox extension monitors Pump.fun for Uxento tokens in real-time and highlights them on axiom.trade/pulse when their images are loaded.

## Features

- 🔍 Real-time monitoring of Pump.fun token creations via WebSocket
- Tags Uxento tokens in Axiom Pulse with an inline `[UXENTO]` badge
- Notifications
- Only maintains the WebSocket connection while axiom.trade is open

## Installation

### Chrome/Edge

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top right)
3. Click "Load unpacked"
4. Select the folder
5. The extension is now installed!

### Firefox

1. Open Firefox and navigate to `about:debugging#/runtime/this-firefox`
2. Click "Load Temporary Add-on"
3. Navigate to the folder and select `manifest.json`
4. The extension is now installed!

### Websocket
A websocket is required you can get one for free here
--https://www.helius.dev/pricing

## Usage

1. Go to https://axiom.trade/pulse
2. Open the extension popup and configure a WebSocket endpoint (bottom button) if one is not already set. You can optionally enable "Keep connection alive" to stream even when the site is closed.
3. While a WebSocket stream is active (axiom.trade is open or the keep-alive toggle is enabled):
   - Its Pulse card gains an inline `[UXENTO]` tag beside the token name (colored using your popup selection)
   - The matching card scrolls into view once per mint
   - The service worker logs detection details to the console
## Notes

- Requires you to supply an appropriate WebSocket endpoint
- Automatically reconnects if WebSocket connection is lost
- Use the keep-alive toggle in the popup if you need the stream while axiom.trade is closed

## Troubleshooting

If the extension isn't working:

1. Make sure you're on https://axiom.trade
2. Ensure a valid WebSocket URL is configured in the popup settings