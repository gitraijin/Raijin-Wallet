/** Side-effect import (app/_layout.tsx): NWC relays over Tor when required. */
import { installTorWebSocket } from './websocket';

installTorWebSocket();
