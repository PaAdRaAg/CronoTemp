import { useEffect, useRef, useState } from 'react'

type Lap = {
  number: number
  elapsed: number
  difference: number
}

type SoundId = 'low-pulse' | 'low-bell' | 'medium-pulse' | 'medium-double' | 'medium-rising' | 'high-pulse' | 'high-double' | 'high-bell'
type RepeatMode = 'once' | 'count' | 'continuous'
type ReminderPreferences = {
  intervalHours: string
  intervalMinutes: string
  intervalSeconds: string
  selectedSound: SoundId
  repeatMode: RepeatMode
  repeatCount: string
  reminderEnabled: boolean
}

const REMINDER_STORAGE_KEY = 'cronotempo:reminder-settings:v1'

const sounds: { id: SoundId; label: string; group: 'Bajos' | 'Medios' | 'Altos'; pattern: 'pulse' | 'double' | 'bell' | 'rising'; volume: number }[] = [
  { id: 'low-pulse', label: 'Pulso suave', group: 'Bajos', pattern: 'pulse', volume: 0.12 },
  { id: 'low-bell', label: 'Campana suave', group: 'Bajos', pattern: 'bell', volume: 0.12 },
  { id: 'medium-pulse', label: 'Pulso', group: 'Medios', pattern: 'pulse', volume: 0.32 },
  { id: 'medium-double', label: 'Doble pulso', group: 'Medios', pattern: 'double', volume: 0.32 },
  { id: 'medium-rising', label: 'Tono ascendente', group: 'Medios', pattern: 'rising', volume: 0.32 },
  { id: 'high-pulse', label: 'Pulso fuerte', group: 'Altos', pattern: 'pulse', volume: 0.58 },
  { id: 'high-double', label: 'Doble pulso fuerte', group: 'Altos', pattern: 'double', volume: 0.58 },
  { id: 'high-bell', label: 'Campana fuerte', group: 'Altos', pattern: 'bell', volume: 0.58 },
]

let audioContext: AudioContext | null = null
let alarmTimer: number | null = null
let alarmStopCallback: (() => void) | null = null
const alarmOscillators = new Set<OscillatorNode>()

function getAudioContext() {
  if (!audioContext) audioContext = new AudioContext()
  if (audioContext.state === 'suspended') void audioContext.resume()
  return audioContext
}

function playSound(sound: SoundId, isAlarm = false) {
  const context = getAudioContext()
  const now = context.currentTime + 0.02
  const soundChoice = sounds.find((choice) => choice.id === sound) ?? sounds[2]

  const tone = (frequency: number, offset: number, duration: number, type: OscillatorType = 'sine') => {
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.type = type
    oscillator.frequency.setValueAtTime(frequency, now + offset)
    gain.gain.setValueAtTime(0.0001, now + offset)
    gain.gain.exponentialRampToValueAtTime(soundChoice.volume, now + offset + 0.015)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + duration)
    oscillator.connect(gain)
    gain.connect(context.destination)
    if (isAlarm) alarmOscillators.add(oscillator)
    oscillator.onended = () => alarmOscillators.delete(oscillator)
    oscillator.start(now + offset)
    oscillator.stop(now + offset + duration + 0.02)
  }

  if (soundChoice.pattern === 'double') {
    tone(740, 0, 0.12)
    tone(740, 0.2, 0.12)
  } else if (soundChoice.pattern === 'bell') {
    tone(880, 0, 0.42, 'sine')
    tone(1320, 0, 0.3, 'sine')
  } else if (soundChoice.pattern === 'rising') {
    tone(620, 0, 0.14)
    tone(880, 0.15, 0.18)
  } else {
    tone(740, 0, 0.18)
  }
}

function stopAlarm() {
  if (alarmTimer !== null) {
    window.clearInterval(alarmTimer)
    alarmTimer = null
  }
  alarmOscillators.forEach((oscillator) => {
    try {
      oscillator.stop()
    } catch {
      // The tone may already have ended.
    }
  })
  alarmOscillators.clear()
  alarmStopCallback?.()
  alarmStopCallback = null
}

function startAlarm(sound: SoundId, mode: RepeatMode, count: number, onRepeatingChange: (repeating: boolean) => void) {
  if (alarmTimer !== null || alarmOscillators.size > 0) return
  playSound(sound, true)

  const totalPlays = mode === 'count' ? Math.max(1, Math.floor(count)) : 1
  if (mode === 'once' || (mode === 'count' && totalPlays === 1)) return

  onRepeatingChange(true)
  let remaining = mode === 'count' ? totalPlays - 1 : Number.POSITIVE_INFINITY
  alarmStopCallback = () => onRepeatingChange(false)
  alarmTimer = window.setInterval(() => {
    if (alarmOscillators.size > 0) return
    playSound(sound, true)
    if (Number.isFinite(remaining)) {
      remaining -= 1
      if (remaining <= 0) {
        if (alarmTimer !== null) window.clearInterval(alarmTimer)
        alarmTimer = null
        alarmStopCallback?.()
        alarmStopCallback = null
      }
    }
  }, 900)
}

function formatTime(milliseconds: number) {
  const totalCentiseconds = Math.floor(milliseconds / 10)
  const centiseconds = totalCentiseconds % 100
  const totalSeconds = Math.floor(totalCentiseconds / 100)
  const seconds = totalSeconds % 60
  const minutes = Math.floor(totalSeconds / 60) % 60
  const hours = Math.floor(totalSeconds / 3600)

  return {
    main: [hours, minutes, seconds]
      .map((value) => String(value).padStart(2, '0'))
      .join(':'),
    fraction: String(centiseconds).padStart(2, '0'),
  }
}

function removeLeadingZeros(value: string) {
  return value.replace(/^0+(?=\d)/, '')
}

function loadReminderPreferences(): ReminderPreferences {
  const defaults: ReminderPreferences = {
    intervalHours: '0',
    intervalMinutes: '0',
    intervalSeconds: '0',
    selectedSound: 'medium-pulse',
    repeatMode: 'once',
    repeatCount: '3',
    reminderEnabled: false,
  }

  try {
    const raw = window.localStorage.getItem(REMINDER_STORAGE_KEY)
    if (!raw) return defaults
    const saved = JSON.parse(raw) as Partial<ReminderPreferences>
    const validNumber = (value: unknown, fallback: string) =>
      typeof value === 'string' && /^\d*$/.test(value) ? removeLeadingZeros(value) : fallback

    return {
      intervalHours: validNumber(saved.intervalHours, defaults.intervalHours),
      intervalMinutes: validNumber(saved.intervalMinutes, defaults.intervalMinutes),
      intervalSeconds: validNumber(saved.intervalSeconds, defaults.intervalSeconds),
      selectedSound: sounds.some((sound) => sound.id === saved.selectedSound) ? saved.selectedSound as SoundId : defaults.selectedSound,
      repeatMode: saved.repeatMode === 'count' || saved.repeatMode === 'continuous' || saved.repeatMode === 'once'
        ? saved.repeatMode
        : defaults.repeatMode,
      repeatCount: validNumber(saved.repeatCount, defaults.repeatCount),
      reminderEnabled: typeof saved.reminderEnabled === 'boolean' ? saved.reminderEnabled : defaults.reminderEnabled,
    }
  } catch {
    return defaults
  }
}

function App() {
  const [initialPreferences] = useState(loadReminderPreferences)
  const [elapsed, setElapsed] = useState(0)
  const [running, setRunning] = useState(false)
  const [laps, setLaps] = useState<Lap[]>([])
  const [intervalHours, setIntervalHours] = useState(initialPreferences.intervalHours)
  const [intervalMinutes, setIntervalMinutes] = useState(initialPreferences.intervalMinutes)
  const [intervalSeconds, setIntervalSeconds] = useState(initialPreferences.intervalSeconds)
  const [selectedSound, setSelectedSound] = useState<SoundId>(initialPreferences.selectedSound)
  const [reminderEnabled, setReminderEnabled] = useState(initialPreferences.reminderEnabled)
  const [repeatMode, setRepeatMode] = useState<RepeatMode>(initialPreferences.repeatMode)
  const [repeatCount, setRepeatCount] = useState(initialPreferences.repeatCount)
  const [alarmRepeating, setAlarmRepeating] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const startedAt = useRef<number | null>(null)
  const savedElapsed = useRef(0)
  const nextReminderAt = useRef<number | null>(null)
  const settingsDialog = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = settingsDialog.current
    if (!dialog) return

    if (settingsOpen && !dialog.open) dialog.showModal()
    if (!settingsOpen && dialog.open) dialog.close()
  }, [settingsOpen])

  const reminderInterval =
    (Number(intervalHours) * 3600 + Number(intervalMinutes) * 60 + Number(intervalSeconds)) * 1000

  useEffect(() => {
    const preferences: ReminderPreferences = {
      intervalHours,
      intervalMinutes,
      intervalSeconds,
      selectedSound,
      repeatMode,
      repeatCount,
      reminderEnabled,
    }
    try {
      window.localStorage.setItem(REMINDER_STORAGE_KEY, JSON.stringify(preferences))
    } catch {
      // The stopwatch remains usable if storage is unavailable.
    }
  }, [intervalHours, intervalMinutes, intervalSeconds, selectedSound, repeatMode, repeatCount, reminderEnabled])

  const currentElapsed = () => startedAt.current === null
    ? elapsed
    : savedElapsed.current + performance.now() - startedAt.current

  useEffect(() => {
    if (!running) return

    let frame = 0
    const update = (now: number) => {
      if (startedAt.current === null) startedAt.current = now
      const current = savedElapsed.current + now - startedAt.current
      setElapsed(current)
      if (reminderEnabled && reminderInterval > 0 && nextReminderAt.current !== null && current >= nextReminderAt.current) {
        startAlarm(selectedSound, repeatMode, Number(repeatCount), setAlarmRepeating)
        nextReminderAt.current = current + reminderInterval
      }
      frame = requestAnimationFrame(update)
    }

    frame = requestAnimationFrame(update)
    return () => cancelAnimationFrame(frame)
  }, [running, reminderEnabled, reminderInterval, selectedSound, repeatMode, repeatCount])

  const start = () => {
    getAudioContext()
    if (running) {
      const current = currentElapsed()
      savedElapsed.current = current
      setElapsed(current)
      startedAt.current = null
      setRunning(false)
      return
    }

    if (reminderEnabled && reminderInterval > 0 && nextReminderAt.current === null) {
      nextReminderAt.current = elapsed + reminderInterval
    }
    startedAt.current = null
    setRunning(true)
  }

  const reset = () => {
    stopAlarm()
    setRunning(false)
    startedAt.current = null
    savedElapsed.current = 0
    setElapsed(0)
    setLaps([])
    nextReminderAt.current = reminderEnabled && reminderInterval > 0 ? reminderInterval : null
  }

  const recordLap = () => {
    const lapElapsed = currentElapsed()
    setElapsed(lapElapsed)
    setLaps((currentLaps) => [
      {
        number: currentLaps.length + 1,
        elapsed: lapElapsed,
        difference: lapElapsed - (currentLaps[0]?.elapsed ?? 0),
      },
      ...currentLaps,
    ])
  }

  const updateInterval = (unit: 'hours' | 'minutes' | 'seconds', value: string) => {
    const normalizedValue = removeLeadingZeros(value)
    if (unit === 'hours') setIntervalHours(normalizedValue)
    if (unit === 'minutes') setIntervalMinutes(normalizedValue)
    if (unit === 'seconds') setIntervalSeconds(normalizedValue)

    const nextHours = unit === 'hours' ? Number(normalizedValue) : Number(intervalHours)
    const nextMinutes = unit === 'minutes' ? Number(normalizedValue) : Number(intervalMinutes)
    const nextSeconds = unit === 'seconds' ? Number(normalizedValue) : Number(intervalSeconds)
    const nextInterval = (nextHours * 3600 + nextMinutes * 60 + nextSeconds) * 1000
    nextReminderAt.current = reminderEnabled && nextInterval > 0 ? currentElapsed() + nextInterval : null
  }

  const toggleReminder = () => {
    if (reminderEnabled) {
      stopAlarm()
      setReminderEnabled(false)
      nextReminderAt.current = null
      return
    }
    if (reminderInterval <= 0) return

    nextReminderAt.current = currentElapsed() + reminderInterval
    setReminderEnabled(true)
  }

  const time = formatTime(elapsed)

  return (
    <main className="page-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="CronoTempo, inicio">
          <img className="brand-logo" src="/icons/cronotempo.svg?v=10" alt="" aria-hidden="true" />
          <span>CronoTempo</span>
        </a>
        <div className="topbar-actions">
          <span className="topbar-label">CRONÓMETRO</span>
          <button className="settings-button" onClick={() => setSettingsOpen(true)} type="button" aria-label="Configuración del aviso" aria-haspopup="dialog" aria-expanded={settingsOpen} title="Configuración del aviso">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" />
              <path d="m19.4 15 .1.1a1.7 1.7 0 0 1-2.4 2.4l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a1.7 1.7 0 0 1-3.4 0v-.2a1.7 1.7 0 0 0-2.9-1.2l-.1.1a1.7 1.7 0 0 1-2.4-2.4l.1-.1a1.7 1.7 0 0 0-1.2-2.9H4a1.7 1.7 0 0 1 0-3.4h.2a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a1.7 1.7 0 0 1 2.4-2.4l.1.1a1.7 1.7 0 0 0 2.9-1.2V2a1.7 1.7 0 0 1 3.4 0v.2a1.7 1.7 0 0 0 2.9 1.2l.1-.1a1.7 1.7 0 0 1 2.4 2.4l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.2a1.7 1.7 0 0 1 0 3.4h-.2a1.7 1.7 0 0 0-1.2 2.9Z" />
            </svg>
          </button>
        </div>
      </header>

      <section className="stopwatch" aria-label="Cronómetro">
        <div className={`status ${running ? 'is-running' : ''}`}>
          <span className="status-dot" />
          {running ? 'EN MARCHA' : elapsed > 0 ? 'EN PAUSA' : 'LISTO'}
        </div>

        <div className="clock" role="timer" aria-live="off" aria-label={`${time.main} y ${time.fraction} centésimas`}>
          <span className="clock-main">{time.main}</span>
          <span className="clock-fraction">.{time.fraction}</span>
        </div>
        <p className="helper-text">Horas <span>:</span> minutos <span>:</span> segundos <span>.</span> centésimas</p>

        <div className="controls">
          <button className="button button-secondary" onClick={reset} disabled={elapsed === 0 && !running}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3L4.5 9" />
              <path d="M4.5 4.8V9h4.2" />
            </svg>
            Reiniciar
          </button>
          <button className="button button-secondary lap-button" onClick={recordLap} disabled={!running}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="8" />
              <path d="M12 7v5l3 2" />
            </svg>
            Vuelta
          </button>
          <button className={`button button-primary ${running ? 'is-paused' : ''}`} onClick={start}>
            {running ? (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M8 5v14M16 5v14" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m8 5 11 7-11 7V5Z" />
              </svg>
            )}
            {running ? 'Pausar' : elapsed > 0 ? 'Continuar' : 'Iniciar'}
          </button>
        </div>

        <dialog
          className="settings-dialog"
          ref={settingsDialog}
          onCancel={(event) => { event.preventDefault(); setSettingsOpen(false) }}
          onClose={() => setSettingsOpen(false)}
          onClick={(event) => { if (event.target === event.currentTarget) setSettingsOpen(false) }}
          aria-labelledby="reminder-title"
        >
        <section className="reminder" aria-labelledby="reminder-title">
          <div className="reminder-heading">
            <div>
              <h2 id="reminder-title">Aviso periódico</h2>
              <p>El sonido se reproduce mientras el cronómetro avanza.</p>
            </div>
            <span className={`reminder-status ${reminderEnabled ? 'is-enabled' : ''}`}>
              {reminderEnabled ? 'ACTIVO' : 'DESACTIVADO'}
            </span>
            <button className="dialog-close" onClick={() => setSettingsOpen(false)} type="button" aria-label="Cerrar configuración" autoFocus>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
            </button>
          </div>

          <div className="interval-fields" aria-label="Intervalo del aviso">
            <label>
              <span>Horas</span>
              <input type="number" min="0" step="1" value={intervalHours} onChange={(event) => updateInterval('hours', event.currentTarget.value)} />
            </label>
            <label>
              <span>Minutos</span>
              <input type="number" min="0" step="1" value={intervalMinutes} onChange={(event) => updateInterval('minutes', event.currentTarget.value)} />
            </label>
            <label>
              <span>Segundos</span>
              <input type="number" min="0" step="1" value={intervalSeconds} onChange={(event) => updateInterval('seconds', event.currentTarget.value)} />
            </label>
          </div>

          <div className="sound-controls">
            <label className="sound-select-label" htmlFor="sound-select">Sonido</label>
            <select id="sound-select" value={selectedSound} onChange={(event) => setSelectedSound(event.currentTarget.value as SoundId)}>
              {(['Bajos', 'Medios', 'Altos'] as const).map((group) => (
                <optgroup label={group} key={group}>
                  {sounds.filter((sound) => sound.group === group).map((sound) => (
                    <option key={sound.id} value={sound.id}>{sound.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
            <button className="preview-button" onClick={() => playSound(selectedSound)} type="button">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 9 6-9 6V6Z" /></svg>
              Probar
            </button>
          </div>

          <div className={`repeat-controls ${repeatMode === 'count' ? 'has-count' : ''}`}>
            <label htmlFor="repeat-mode">Repetir sonido</label>
            <select id="repeat-mode" value={repeatMode} onChange={(event) => setRepeatMode(event.currentTarget.value as RepeatMode)}>
              <option value="once">Una vez</option>
              <option value="count">Un número de veces</option>
              <option value="continuous">Indefinidamente</option>
            </select>
            {repeatMode === 'count' && (
              <label className="repeat-count-label">
                <span>Cantidad</span>
                <input type="number" min="1" step="1" value={repeatCount} onChange={(event) => setRepeatCount(removeLeadingZeros(event.currentTarget.value))} />
              </label>
            )}
          </div>
          <p className="repeat-help">
            {repeatMode === 'continuous'
              ? 'Se repetirá hasta que silencies el sonido.'
              : repeatMode === 'count'
                ? 'La cantidad incluye el primer sonido.'
                : 'El aviso sonará una sola vez.'}
          </p>

          {alarmRepeating && (
            <button className="silence-button" onClick={stopAlarm} type="button">
              Silenciar sonido
            </button>
          )}

          <button className="reminder-toggle" onClick={toggleReminder} disabled={!reminderEnabled && reminderInterval <= 0} type="button">
            {reminderEnabled ? 'Desactivar aviso' : 'Activar aviso'}
          </button>
        </section>
        </dialog>

        {laps.length > 0 && (
          <section className="laps" aria-label="Vueltas registradas">
            <div className="laps-heading">
              <span>VUELTA</span>
              <span>TIEMPO TOTAL</span>
              <span>DIFERENCIA</span>
            </div>
            <ol className="laps-list">
              {laps.map((lap) => (
                <li className="lap-row" key={lap.number}>
                  <span className="lap-number">{String(lap.number).padStart(2, '0')}</span>
                  <span className="lap-time">{formatTime(lap.elapsed).main}<small>.{formatTime(lap.elapsed).fraction}</small></span>
                  <span className="lap-difference">+{formatTime(lap.difference).main}<small>.{formatTime(lap.difference).fraction}</small></span>
                </li>
              ))}
            </ol>
          </section>
        )}
      </section>

      {alarmRepeating && (
        <button className="floating-silence" onClick={stopAlarm} type="button">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 10v4h4l5 4V6l-5 4H4Z" />
            <path d="m17 9 4 6m0-6-4 6" />
          </svg>
          Silenciar sonido
        </button>
      )}

      <footer className="footer">
        <span>Un momento a la vez.</span>
        <span className="footer-line" />
        <span>Powered by <strong>MAXEON</strong></span>
      </footer>
    </main>
  )
}

export default App
