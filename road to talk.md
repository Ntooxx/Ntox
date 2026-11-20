# Road to Talk

**Obiettivo:** trasformare Ntox da un agente che *legge e scrive* in un agente che *sente e parla*, con una voce propria coerente con l'identità cognitiva che già impara nel loop ALIVE — senza violare il principio "stays local".

Documento di progetto — collegato a `road-to-self-truth.md` e al baseline `experiments/alive/2026-10-18-baseline.md`.

---

## 1. Tesi

Oggi Ntox ha già l'**anatomia** della voce ma non ha la **bocca nel terminale** e non ha un **proprio timbro**:

- `src/tools/stt.ts` trascrive con Whisper, `src/tools/voice.ts` sintetizza con OpenAI TTS — ma **entrambi puntano a `api.openai.com` usando `config.apiKey`**, che di default è una chiave **OpenRouter** (`src/core/config.ts:185-186`). Con la configurazione standard le chiamate audio falliscono con 401. È il primo difetto da chiudere.
- La voce esiste solo nei canali *messaggistica*: Telegram/WhatsApp (voice note) e Web UI (`WebVoiceHandlers`). Il **CLI REPL** — la superficie core — è muto e sordo.
- La "voce" di Ntox oggi è solo **stilistica**: `ProfileVoice { directness, verbosity }` in `src/mind/profile.ts:17` e il voice A/B di `scripts/bench-alive.mjs:45` misurano *come scrive*, non *come suona*.

**Talk = due pipeline gemelle (ascolto/parlato) con un provider audio indipendente da quello LLM, una voce configurabile e un timbro derivato dal profilo cognitivo.**

---

## 2. Cosa esiste già (da non ricostruire)

| Capability | File | Cosa offre |
|---|---|---|
| STT | `src/tools/stt.ts:5` | `sttTool`: base64 o path → testo, modello `whisper-1`, endpoint OpenAI transcriptions |
| TTS | `src/tools/voice.ts:15` | `ttsTool`: testo → data URL audio, modello `tts-1`, voci `alloy/echo/fable/onyx/nova/shimmer`, formati mp3/opus/aac/flac/wav/pcm |
| Registrazione tool | `src/core/dispatcher.ts:156` | `ttsTool` (e `sttTool`) già nel registry e nella allowlist (`src/core/config.ts:160`) |
| Wrapper gateway | `src/gateway/index.ts:461-475` | `transcribeAudio` / `synthesizeSpeech` già cablati ai tool |
| Voice handlers Web | `src/gateway/index.ts:535-550` | `WebVoiceHandlers { transcribe, synthesize }` per la UI |
| Voice note | `src/gateway/media-send.ts` | `createTelegramVoiceSender`, `createWhatsAppVoiceSender` |
| Telegram voice | `src/gateway/telegram.ts:273-322` | download → transcribe → `onMessage` → synthesize → `sendVoice` |
| Modalità voce | `src/gateway/voice-mode.ts:5` | `VoiceMode = "on"\|"off"\|"auto"`, `resolveVoiceReply`, `voiceReplyText` (max 600 char), `/voice` |
| Utility audio | `src/gateway/voice.ts` | `audioFilenameFor`, `clampTtsText` (4000 char), `voiceAudioError`, `dataUrlToVoice` |
| Profilo vocale | `src/mind/profile.ts:17` | `ProfileVoice { directness, verbosity }`, `voiceFromLedger` — il "carattere" da mappare sul timbro |
| Identity A/B | `src/benchmark/voice-ab.ts`, `scripts/m5-run.mjs:197` | `runVoiceAB` — misura quanto la voce stilistica è riconoscibile |

---

## 3. Cosa manca

1. **Disaccoppiamento audio/LLM** — `sttTool`/`ttsTool` usano `config.apiKey` e URL OpenAI fissi, ignorando `provider` e `apiBaseUrl`. Con OpenRouter (default) non funzionano.
2. **Nessuna scelta di modello/voce** — `NtoxConfig` (`src/types/index.ts:100-167`) non ha campi audio; non si può scegliere motore, modello o timbro.
3. **REPL muto** — nessun microfono, nessuna riproduzione, nessun push-to-talk in `src/cli/repl.ts`.
4. **Voce non identitaria** — `ProfileVoice` non influisce sul suono; l'identity A/B resta testuale.
5. **Nessuna modalità conversazionale** — il flusso è sempre *turno → testo → (opzionale) voice note*; manca il full-duplex con barge-in.
6. **Nessun percorso offline** — se la rete manca, non esiste STT/TTS locale, pur essendo "local-first" un pilastro del progetto.

---

## 4. Che modello possiamo utilizzare

### 4.1 Ascolto (STT)

| Opzione | Modello | Pro | Contro | Verdetto |
|---|---|---|---|---|
| OpenAI | `gpt-4o-mini-transcribe` | più accurato di Whisper, supporta prompt contestuale | endpoint a pagamento | **Default consigliato** |
| Groq | `whisper-large-v3` | velocissimo, economico, **groq è già un provider supportato** | richiede chiave Groq | **Default alternativo / più economico** |
| OpenAI legacy | `whisper-1` | già implementato | più lento, meno accurato | fallback per retrocompatibilità |
| Locale | `whisper.cpp` / `faster-whisper` | zero dati in uscita, offline | richiede modello scaricato (~75–500 MB) | **Profilo `local`** |

**Scelta:** `gpt-4o-mini-transcribe` come default remoto, `whisper-large-v3` su Groq come opzione rapida, `whisper.cpp` come opzione locale. Il modello precedente resta selezionabile via config.

### 4.2 Parlato (TTS)

| Opzione | Modello / voci | Pro | Contro | Verdetto |
|---|---|---|---|---|
| OpenAI | `gpt-4o-mini-tts` + `voice` + `instructions` | **timbro dirigibile con istruzioni**, economicamente conveniente | richiede chiave OpenAI | **Default consigliato** |
| OpenAI | `tts-1-hd` / `tts-1` | già implementato, 6 voci | nessun controllo di tono | fallback |
| OpenRouter | `openai/gpt-4o-mini-tts` | riutilizza la chiave OpenRouter già presente | copertura audio da verificare | opzione "tutto su OpenRouter" |
| ElevenLabs | `eleven_multilingual_v2` | qualità top, molte voci | servizio esterno aggiuntivo | opzione premium |
| Locale | `Kokoro` / `Piper` | offline, privacy totale | qualità inferiore, voci limitate | **Profilo `local`** |

**Scelta:** `gpt-4o-mini-tts`, con `instructions` Generate dal profilo cognitivo. Questo è il punto chiave: la voce di Ntox non è una voce "carina" qualsiasi, è **la stessa identità che il voice A/B già misura**, solo udibile.

### 4.3 Conversazione (fase avanzata)

| Opzione | Modello | Note |
|---|---|---|
| OpenAI Realtime | `gpt-4o-realtime-preview` | speech-to-speech nativo, latenza ~300 ms, barge-in; elimina il trio STT→LLM→TTS |
| Pipeline locale | VAD → STT → LLM → TTS | più controllo e privacy, latenza ~1–2 s, barge-in gestito dal VAD |

---

## 5. Che voce

**Timbro consigliato: `nova` (calda, amichevole) come default `tts-1`; per `gpt-4o-mini-tts` usare una voce base e steering via `instructions`.**

La vera "voce di Ntox" però non è il nome del preset: è una **funzione del profilo**:

```
instructions = "Parla con directness {voice.directness} e verbosity {voice.verbosity}. "
              + "Se directness > 0.6 sii asciutto e vai dritto al punto; "
              + "se < 0.4 ammorbidisci con brevi risorse. "
              + "Mantieni la calibrazione: ammetti l'incertezza invece di affermare con sicurezza."
```

- `voice.directness` e `voice.verbosity` arrivano da `src/mind/profile.ts:138-140` e `voiceFromLedger` (`src/mind/profile.ts:109`), quindi **si evolvono con le correzioni dell'utente**.
- Il voice A/B (`src/benchmark/voice-ab.ts`) va esteso: oltre a riconoscere *trained vs fresh* dal testo, deve riuscire a riconoscerli **dall'audio** — la voice divergence diventa una metrica ALIVE udibile.
- Italiano: `gpt-4o-mini-tts` e `tts-1-hd` gestiscono bene l'IT; per il preset locale preferire `Kokoro` con voice `it` se disponibile, altrimenti `Piper it-it`.

Comandi previsti: `/voice voice <nova|onyx|...>`, `/voice style <none|profile>`, `/voice engine <openai|groq|local>`.

---

## 6. Architettura target

```
src/audio/                       (nuovo — provider audio, speculare ai 10 provider LLM)
├── types.ts                     AudioProvider, TranscribeOptions, SynthesizeOptions
├── stt/
│   ├── openai.ts                gpt-4o-mini-transcribe / whisper-1
│   ├── groq.ts                  whisper-large-v3
│   └── local.ts                 whisper.cpp HTTP endpoint
├── tts/
│   ├── openai.ts                gpt-4o-mini-tts / tts-1-hd + instructions
│   ├── openrouter.ts
│   └── local.ts                 Kokoro / Piper HTTP endpoint
├── identity.ts                  ProfileVoice → TTS instructions
└── index.ts                     resolveAudioProviders(config)
```

- `src/tools/stt.ts` e `src/tools/voice.ts` diventano **wrapper sottili** che deleghiamo a `src/audio/`, mantenendo la firma `Tool` e i test esistenti.
- `src/gateway/index.ts:461-475` resta invariato: continua a chiamare i tool, quindi nessun cambiamento nei canali.
- Novità: `src/cli/voice-input.ts` (mic/VAD/push-to-talk) e `src/cli/voice-output.ts` (playback) usati solo dal REPL.

---

## 7. Fasi di implementazione

### Fase 0 — Chiudere la falla dei 401 (immediata)

- [ ] Aggiungere a `NtoxConfig` (`src/types/index.ts:100`) e a `ConfigSchema` (`src/core/config.ts:65`): `sttProvider`, `sttModel`, `ttsProvider`, `ttsModel`, `ttsVoice`, `ttsInstructions`, `audioBaseUrl?`, `sttApiKey?`, `ttsApiKey?`.
- [ ] `sttTool` e `ttsTool` leggono chiave/endpoint dal **provider audio**, non da `config.apiKey` fisso. Default: OpenAI per TTS, OpenAI/Groq per STT.
- [ ] `src/setup.ts`: 3 domande in più (usare audio? provider? voce?).
- [ ] `src/doctor.ts`: check "Audio provider raggiungibile".
- [ ] Test: con chiave OpenRouter e provider audio OpenAI, la richiesta parte con la chiave audio corretta (oggi fallirebbe).

### Fase 1 — Provider audio

- [ ] Creare `src/audio/` con `resolveAudioProviders(config)` speculare al resolver LLM.
- [ ] Implementare adapter OpenAI, Groq, locale per STT; OpenAI, OpenRouter, locale per TTS.
- [ ] `sttTool`/`ttsTool` delegano; i test attuali (`src/tools/voice.test.ts`, `src/tools/stt.test.ts`) devono restare verdi.
- [ ] Test di contratto per ogni provider (mock fetch), incluso il fallback local-hash→locale.

### Fase 2 — Voce identitaria

- [ ] `src/audio/identity.ts`: `ProfileVoice` → `ttsInstructions`, con legame a `mind.profile` (`src/mind/mind.ts:285`).
- [ ] `ttsTool` accetta `instructions` opzionali; `synthesizeSpeech` (`src/gateway/index.ts:469`) passa quelle del profilo.
- [ ] Estendere `handleVoiceCommand` (`src/gateway/voice-mode.ts:72`) con `voice`, `style`, `engine`.
- [ ] Estendere `runVoiceAB` con variante audio; aggiungere `audioIdentificationRate` ad `AliveMetrics`.
- [ ] Test: due profili con directness diversa producono `instructions` diverse.

### Fase 3 — Il REPL sente e parla

- [ ] `src/cli/voice-input.ts`: cattura microfono via `ffmpeg`/`sox` (o `portaudio` come dipendenza opzionale), VAD con soglia di silenzio, push-to-talk (es. `Ctrl+Space`).
- [ ] `src/cli/voice-output.ts`: playback del data URL TTS via player di sistema (`afplay`/`aplay`/`powershell`), con coda non bloccante.
- [ ] Comandi REPL: `/mic on|off|auto`, `/speak on|off`, `/voice voice ...` (riutilizzo del parser gateway).
- [ ] Il testo trascritto entra nello stesso `agent.process` del testo digitato — **nessun percorso parallelo** nel kernel cognitivo.
- [ ] Test: audio sintetico → transcript → risposta → audio, con fetch mockati.

### Fase 4 — Conversazione full-duplex

- [ ] Provider Realtime (`gpt-4o-realtime-preview`) con WebSocket: audio in streaming, barge-in, interruzione.
- [ ] In alternativa pipeline locale streaming: VAD → STT → LLM → TTS, con `AbortController` sul TTS quando l'utente parla sopra.
- [ ] Modalità `/voice live` solo per REPL e Web UI; i canali messaggistica restano voice-note (già adatti al loro medium).
- [ ] Telemetria: latenza end-of-speech → inizio risposta, target < 1 s (Realtime) / < 2 s (locale).

### Fase 5 — Offline, sicurezza, documentazione

- [ ] Profilo `local`: whisper.cpp + Kokoro/Piper, nessun byte in uscita; rilevamento automatico se `audioBaseUrl` punta a `localhost`.
- [ ] Policy: il microfono è un tool come gli altri — allowlist, audit in `/trace`, nessuna registrazione persistente senza consenso esplicito.
- [ ] `SECURITY.md`: sezione "Audio — biometrici e retention"; i dati vocali non entrano nel ledger né nella memoria episodica.
- [ ] README: support matrix con `Voice (REPL)` e `Voice (live)`, aggiornamento riga `src/tools/` in Architecture.
- [ ] `npm run verify:all`, `npm run lint`, `npm run typecheck` verdi.

---

## 8. Configurazione proposta

```json
{
  "sttProvider": "openai",
  "sttModel": "gpt-4o-mini-transcribe",
  "ttsProvider": "openai",
  "ttsModel": "gpt-4o-mini-tts",
  "ttsVoice": "nova",
  "ttsStyle": "profile",
  "audioBaseUrl": "",
  "sttApiKey": "",
  "ttsApiKey": ""
}
```

`sttApiKey`/`ttsApiKey` vuoti ⇒ si usa `apiKey`; se il provider è `openrouter` si usa `apiKey`. `audioBaseUrl` vuoto ⇒ endpoint default del provider. `ttsStyle: "profile"` genera le `instructions` dal profilo; `"none"` lascia la voce neutra.

---

## 9. Rischi e anti-goal

- **401 silenziosi:** se non si separa la chiave audio da quella LLM, la Fase 0 non è opzionale — è il blocco di tutto il resto.
- **Latenza:** il trio STT→LLM→TTS aggiunge ~1–2 s; senza streaming la conversazione sembra un communicator, non un dialogo. Mitigazione: Realtime o pipeline streaming in Fase 4.
- **Privacy:** la voce è un dato biometrico. Nessun audio greco in memoria/ledger; consenso esplicito prima dell'invio a provider remoti; il profilo locale resta la via preferita per dati sensibili.
- **Goodhart della voce:** se addestriamo solo per "suonare come Ntox", rischiamo di premiare il timbro e non il contenuto. Il voice A/B audio resta un **segnale secondario**, subordinato a `objectiveScore` e calibrazione (`road-to-self-truth.md`, P0).
- **Deriva identitaria:** se `directness` sale mentre `calibrationEce` peggiora, il timbro diventa arroganza — vale il guardrail di `src/meta/autonomy.ts`.
- **Non obiettivo:** non sostituire il testo. Voice è un canale in più; il REPL resta leggibile e il testo resta la sorgente di verità per il ledger.

---

## 10. Definition of done

1. `ntox setup` configura audio senza errori con una chiave OpenRouter e una chiave audio distinta; `ntox doctor` riporta tutti i check verdi.
2. REPL: `/mic on`, parlo, Ntox trascrive, risponde e **parla**; `/trace` mostra modello STT, modello TTS, voce e istruzioni usate.
3. Telegram/WhatsApp/Web continuano a funzionare con i test attuali verdi — nessuna regressione nei 1717 test.
4. Due profili con `directness` diversa sono distinguibili **all'ascolto** nel voice A/B audio.
5. `npm run verify:all` verde e README aggiornato con la support matrix voce.

---

## 11. Ordine di priorità consigliato

**Fase 0 → 1 → 2 → 3 → 5 → 4.** La Fase 4 (Realtime) è il "wow" ma è anche la più costosa e la più facile da sbagliare: ha senso solo dopo che la Fase 0 ha reso l'audio affidabile e la Fase 2 ha dato a Ntox una voce che vale la pena ascoltare.
