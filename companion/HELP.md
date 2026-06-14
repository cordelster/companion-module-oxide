# OXIDE Tape Workflow

Controls the [OXIDE](https://github.com/cordelster/oxide) tape digitization workflow engine.

## Configuration

| Field | Description |
|-------|-------------|
| **OXIDE Host** | Hostname or IP address of the machine running OXIDE (auto-discoverable via `_oxide._tcp` mDNS) |
| **Port** | HTTP port OXIDE is listening on (default: `8080`) |

## Actions

### Decks
- **Stop All Decks** — stops recording and disables remote on every connected HyperDeck
- **Stop Deck** — stops a single deck by IP address
- **Set Deck Remote** — enable or disable remote control on a deck
- **Reboot Deck** — reboots a deck (rejected if currently recording)

### VTR (Sony 9-pin)
- **VTR Play** — sends Play to the named VTR
- **VTR Stop** — sends Stop
- **VTR Rewind** — rewinds tape
- **VTR Eject** — ejects tape

### Automation
- **Inject Event** — posts a custom event to the OXIDE automation engine
- **Stop Workflow Run** — stops an in-progress run by tape ID
- **Reload Workflows** — reloads workflow definitions from disk

## Feedbacks

| Feedback | Condition |
|----------|-----------|
| Deck: Recording | Deck at given IP is actively recording |
| Deck: Idle | Deck is idle |
| Deck: Warning | Deck is in warning state |
| Deck: Remote Enabled | Remote control is enabled on deck |
| VTR: Playing | Named VTR transport state is PLAY |
| VTR: Stopped | Named VTR is STOPPED or at TAPE_END |
| VTR: Tape Present | Cassette is loaded in named VTR |
| VTR: At Tape End | Named VTR has reached end of tape |
| VTR: Hardware Error | Named VTR reported an ERROR state |

## Variables

Variables are created dynamically based on the connected decks. Each deck gets four variables using its label (or IP if no label is set):

- `$(oxide:deck_1_status)` — recording / idle / warning
- `$(oxide:deck_1_timecode)` — current timecode
- `$(oxide:deck_1_clip)` — current clip name
- `$(oxide:deck_1_nas)` — NAS mount status

VTR state variables use the name configured in OXIDE:

- `$(oxide:vtr_deck1_state)` — PLAY / STOPPED / TAPE_END / ERROR / UNKNOWN
