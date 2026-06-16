import { InstanceBase, runEntrypoint, InstanceStatus, combineRgb } from '@companion-module/base'

const DECK_POLL_MS = 500   // deck status + VTR state refresh rate
const VTR_POLL_RATIO = 4   // poll VTR serial every Nth deck poll (~2s)

class OxideInstance extends InstanceBase {
  async init(config) {
    this.config   = config
    this.decks    = []   // array of deck state objects from GET /decks
    this.vtrs     = []   // [{name, port, status}] — status from GET /vtrs/{name}/status
    this._timer   = null
    this._pollN   = 0

    this.updateStatus(InstanceStatus.Connecting)
    this._setActions()
    this._setFeedbacks()
    this._setVariables([])
    this._startPolling()
  }

  async destroy() {
    this._stopPolling()
  }

  getConfigFields() {
    return [
      {
        type: 'textinput',
        id: 'host',
        label: 'OXIDE Host',
        default: 'localhost',
        tooltip: 'Hostname or IP address — auto-discoverable via _oxide._tcp mDNS',
        width: 8,
      },
      {
        type: 'number',
        id: 'port',
        label: 'Port',
        default: 8080,
        min: 1,
        max: 65535,
        width: 4,
      },
    ]
  }

  async configUpdated(config) {
    this.config = config
    this._stopPolling()
    this._startPolling()
  }

  // ---- Helpers ----------------------------------------------------------------

  _base() {
    return `http://${this.config.host}:${this.config.port}`
  }

  async _post(path, body) {
    const opts = { method: 'POST' }
    if (body !== undefined) {
      opts.headers = { 'Content-Type': 'application/json' }
      opts.body    = JSON.stringify(body)
    }
    return fetch(`${this._base()}${path}`, opts)
  }

  // ---- Polling ----------------------------------------------------------------

  _startPolling() {
    this._poll()
    this._timer = setInterval(() => this._poll(), DECK_POLL_MS)
  }

  _stopPolling() {
    if (this._timer) {
      clearInterval(this._timer)
      this._timer = null
    }
  }

  async _poll() {
    this._pollN++
    const pollVtrs = this._pollN % VTR_POLL_RATIO === 0

    try {
      // Always fetch deck status; fetch VTR list on first poll then periodically
      const fetches = [fetch(`${this._base()}/decks`)]
      if (pollVtrs || this._pollN === 1) {
        fetches.push(fetch(`${this._base()}/vtrs`).catch(() => null))
      }

      const [decksRes, vtrsRes] = await Promise.all(fetches)

      if (!decksRes.ok) throw new Error(`/decks returned HTTP ${decksRes.status}`)
      const newDecks = await decksRes.json()

      // Rebuild variable definitions when deck list changes
      const prevIps = this.decks.map(d => d.ip).join(',')
      const nextIps = newDecks.map(d => d.ip).join(',')
      if (prevIps !== nextIps) {
        this._setVariables(newDecks)
      }
      this.decks = newDecks

      // VTR list + serial status poll
      if (vtrsRes?.ok) {
        const vtrList = await vtrsRes.json()
        this.vtrs = await Promise.all(
          vtrList.map(async ({ name, port }) => {
            try {
              const r      = await fetch(`${this._base()}/vtrs/${name}/status`)
              const status = r.ok ? await r.json() : null
              return { name, port, status }
            } catch {
              return { name, port, status: null }
            }
          })
        )
      } else if (pollVtrs && this.vtrs.length > 0) {
        // Refresh status for known VTRs
        this.vtrs = await Promise.all(
          this.vtrs.map(async (vtr) => {
            try {
              const r      = await fetch(`${this._base()}/vtrs/${vtr.name}/status`)
              const status = r.ok ? await r.json() : vtr.status
              return { ...vtr, status }
            } catch {
              return vtr
            }
          })
        )
      }

      this.updateStatus(InstanceStatus.Ok)
      this._updateVariables()
      this.checkFeedbacks()
    } catch (e) {
      this.updateStatus(InstanceStatus.ConnectionFailure, String(e))
    }
  }

  // ---- Actions ----------------------------------------------------------------

  _setActions() {
    this.setActionDefinitions({

      // --- Deck ---

      stop_all: {
        name: 'Stop All Decks',
        options: [],
        callback: async () => { await this._post('/stop-all') },
      },

      deck_stop: {
        name: 'Stop Deck',
        options: [
          { type: 'textinput', id: 'ip', label: 'Deck IP', default: '' },
        ],
        callback: async ({ options }) => {
          await this._post(`/decks/${options.ip}/stop`)
        },
      },

      deck_remote: {
        name: 'Set Deck Remote',
        options: [
          { type: 'textinput', id: 'ip', label: 'Deck IP', default: '' },
          {
            type: 'dropdown', id: 'enabled', label: 'Remote',
            choices: [{ id: 'true', label: 'Enable' }, { id: 'false', label: 'Disable' }],
            default: 'true',
          },
        ],
        callback: async ({ options }) => {
          await this._post(`/decks/${options.ip}/remote?enabled=${options.enabled}`)
        },
      },

      deck_reboot: {
        name: 'Reboot Deck',
        options: [
          { type: 'textinput', id: 'ip', label: 'Deck IP', default: '' },
        ],
        callback: async ({ options }) => {
          await this._post(`/decks/${options.ip}/reboot`)
        },
      },

      // --- VTR ---

      vtr_play: {
        name: 'VTR Play',
        options: [
          { type: 'textinput', id: 'name', label: 'VTR name (e.g. deck1)', default: '' },
        ],
        callback: async ({ options }) => {
          await this._post(`/vtrs/${options.name}/play`)
        },
      },

      vtr_stop: {
        name: 'VTR Stop',
        options: [
          { type: 'textinput', id: 'name', label: 'VTR name', default: '' },
        ],
        callback: async ({ options }) => {
          await this._post(`/vtrs/${options.name}/stop`)
        },
      },

      vtr_rewind: {
        name: 'VTR Rewind',
        options: [
          { type: 'textinput', id: 'name', label: 'VTR name', default: '' },
        ],
        callback: async ({ options }) => {
          await this._post(`/vtrs/${options.name}/rewind`)
        },
      },

      vtr_eject: {
        name: 'VTR Eject',
        options: [
          { type: 'textinput', id: 'name', label: 'VTR name', default: '' },
        ],
        callback: async ({ options }) => {
          await this._post(`/vtrs/${options.name}/eject`)
        },
      },

      // --- Automation ---

      inject_event: {
        name: 'Inject Event',
        options: [
          { type: 'textinput', id: 'type',    label: 'Event type',       default: '' },
          { type: 'textinput', id: 'payload', label: 'Payload (JSON)',   default: '{}' },
        ],
        callback: async ({ options }) => {
          let payload = {}
          try { payload = JSON.parse(options.payload) } catch { /* invalid JSON — send empty */ }
          await this._post('/automation/events', { type: options.type, payload })
        },
      },

      stop_run: {
        name: 'Stop Workflow Run',
        options: [
          { type: 'textinput', id: 'tape_id', label: 'Tape ID', default: '' },
        ],
        callback: async ({ options }) => {
          await this._post(`/automation/runs/${options.tape_id}/stop`)
        },
      },

      automation_reload: {
        name: 'Reload Workflows',
        options: [],
        callback: async () => { await this._post('/automation/reload') },
      },
    })
  }

  // ---- Feedbacks --------------------------------------------------------------

  _setFeedbacks() {
    this.setFeedbackDefinitions({

      deck_recording: {
        type: 'boolean',
        name: 'Deck: Recording',
        defaultStyle: { bgcolor: combineRgb(200, 0, 0), color: combineRgb(255, 255, 255) },
        options: [
          { type: 'textinput', id: 'ip', label: 'Deck IP', default: '' },
        ],
        callback: ({ options }) => this._deckField(options.ip, 'status') === 'recording',
      },

      deck_idle: {
        type: 'boolean',
        name: 'Deck: Idle',
        defaultStyle: { bgcolor: combineRgb(0, 160, 0), color: combineRgb(255, 255, 255) },
        options: [
          { type: 'textinput', id: 'ip', label: 'Deck IP', default: '' },
        ],
        callback: ({ options }) => this._deckField(options.ip, 'status') === 'idle',
      },

      deck_warning: {
        type: 'boolean',
        name: 'Deck: Warning',
        defaultStyle: { bgcolor: combineRgb(220, 120, 0), color: combineRgb(255, 255, 255) },
        options: [
          { type: 'textinput', id: 'ip', label: 'Deck IP', default: '' },
        ],
        callback: ({ options }) => this._deckField(options.ip, 'status') === 'warning',
      },

      deck_remote_enabled: {
        type: 'boolean',
        name: 'Deck: Remote Enabled',
        defaultStyle: { bgcolor: combineRgb(0, 80, 200), color: combineRgb(255, 255, 255) },
        options: [
          { type: 'textinput', id: 'ip', label: 'Deck IP', default: '' },
        ],
        callback: ({ options }) => this._deckField(options.ip, 'remote_enabled') === true,
      },

      vtr_playing: {
        type: 'boolean',
        name: 'VTR: Playing',
        defaultStyle: { bgcolor: combineRgb(0, 180, 0), color: combineRgb(255, 255, 255) },
        options: [
          { type: 'textinput', id: 'name', label: 'VTR name', default: '' },
        ],
        callback: ({ options }) => this._vtrField(options.name, 'state') === 'PLAY',
      },

      vtr_stopped: {
        type: 'boolean',
        name: 'VTR: Stopped',
        defaultStyle: { bgcolor: combineRgb(80, 80, 80), color: combineRgb(255, 255, 255) },
        options: [
          { type: 'textinput', id: 'name', label: 'VTR name', default: '' },
        ],
        callback: ({ options }) => {
          const state = this._vtrField(options.name, 'state')
          return state === 'STOPPED' || state === 'TAPE_END'
        },
      },

      vtr_tape_present: {
        type: 'boolean',
        name: 'VTR: Tape Present',
        defaultStyle: { bgcolor: combineRgb(0, 100, 180), color: combineRgb(255, 255, 255) },
        options: [
          { type: 'textinput', id: 'name', label: 'VTR name', default: '' },
        ],
        callback: ({ options }) => this._vtrField(options.name, 'cassette_in') === true,
      },

      vtr_at_end: {
        type: 'boolean',
        name: 'VTR: At Tape End',
        defaultStyle: { bgcolor: combineRgb(200, 160, 0), color: combineRgb(0, 0, 0) },
        options: [
          { type: 'textinput', id: 'name', label: 'VTR name', default: '' },
        ],
        callback: ({ options }) => this._vtrField(options.name, 'tape_at_end') === true,
      },

      vtr_error: {
        type: 'boolean',
        name: 'VTR: Hardware Error (live serial)',
        defaultStyle: { bgcolor: combineRgb(255, 0, 100), color: combineRgb(255, 255, 255) },
        options: [
          { type: 'textinput', id: 'name', label: 'VTR name', default: '' },
        ],
        callback: ({ options }) => this._vtrField(options.name, 'state') === 'ERROR',
      },

      deck_vtr_error: {
        type: 'boolean',
        name: 'Deck: VTR Error (automation monitor)',
        description: 'True when the automation monitor reports VTR in ERROR state (e.g. E06 fault during a run). Cleared when no run is active.',
        defaultStyle: { bgcolor: combineRgb(255, 0, 100), color: combineRgb(255, 255, 255) },
        options: [
          { type: 'textinput', id: 'ip', label: 'Deck IP', default: '' },
        ],
        callback: ({ options }) => this._deckField(options.ip, 'vtr_state') === 'ERROR',
      },
    })
  }

  _deckField(ip, field) {
    return this.decks.find(d => d.ip === ip)?.[field]
  }

  _vtrField(name, field) {
    return this.vtrs.find(v => v.name === name)?.status?.[field]
  }

  // ---- Variables --------------------------------------------------------------

  _setVariables(decks) {
    const defs = []

    for (const deck of decks) {
      const key = this._deckKey(deck)
      defs.push(
        { variableId: `${key}_status`,      name: `${deck.label || deck.ip} Status` },
        { variableId: `${key}_timecode`,    name: `${deck.label || deck.ip} Timecode` },
        { variableId: `${key}_clip`,        name: `${deck.label || deck.ip} Clip` },
        { variableId: `${key}_nas`,         name: `${deck.label || deck.ip} NAS Status` },
        { variableId: `${key}_vtr_state`,   name: `${deck.label || deck.ip} VTR State` },
        { variableId: `${key}_vtr_timecode`,name: `${deck.label || deck.ip} VTR Timecode` },
      )
    }

    // VTR variables use stable names (deck1, deck2, …) — defined once, updated from poll
    for (const vtr of this.vtrs) {
      defs.push({ variableId: `vtr_${vtr.name}_state`, name: `VTR ${vtr.name} State` })
    }

    this.setVariableDefinitions(defs)
  }

  _updateVariables() {
    const vals = {}

    for (const deck of this.decks) {
      const key = this._deckKey(deck)
      vals[`${key}_status`]       = deck.status       ?? ''
      vals[`${key}_timecode`]     = deck.timecode      ?? ''
      vals[`${key}_clip`]         = deck.clip          ?? ''
      vals[`${key}_nas`]          = deck.nas_status    ?? ''
      vals[`${key}_vtr_state`]    = deck.vtr_state     ?? ''
      vals[`${key}_vtr_timecode`] = deck.vtr_timecode  ?? ''
    }

    for (const vtr of this.vtrs) {
      vals[`vtr_${vtr.name}_state`] = vtr.status?.state ?? 'UNKNOWN'
    }

    this.setVariableValues(vals)
  }

  _deckKey(deck) {
    // Use label if set (e.g. "Deck 1" → "deck_1"), otherwise sanitize IP
    return (deck.label || deck.ip)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
  }
}

runEntrypoint(OxideInstance, [])
