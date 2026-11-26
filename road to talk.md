# Road to Talk

**Obiettivo:** trasformare Ntox da un agente che *legge e scrive* in un agente che *sente e parla*, con una voce propria coerente con l'identità cognitiva che già impara nel loop ALIVE — senza violare il principio "stays local".

Documento di progetto — collegato a `road-to-self-truth.md` e al baseline `experiments/alive/2026-10-18-baseline.md`.

---

## 1. Tesi (stato aggiornato al codice)

La tesi originale è realizzata: `src/audio/` fornisce pipeline gemelle di ascolto/parlato con provider indipendente da quello LLM, il REPL sente e parla, e il timbro deriva dal profilo cognitivo. Le sezioni 2–3 e le fasi di implementazione sotto sono state riconciliate con il codice: la "falla 401" e il "REPL muto" non sono più difetti aperti.

**Obiettivo residuo:** rendere la voce *verificabile* (latenza misurata, privacy documentata, segnale audio subordinato a `objectiveScore`) e completare il percorso offline self-contained.

---

## 2. Cosa esiste già (da non ricostruire)

| Capability | File | Cosa offre |
|---|---|---|
| Provider audio | `src/audio/index.ts:7` | `resolveAudioProviders(config)`: OpenAI/Groq/local per STT, OpenAI/OpenRouter/local per TTS |
| Tool STT/TTS | `src/tools/stt.ts`, `src/tools/voice.ts` | delegano al provider audio con chiave/endpoint dedicati — non usano più `config.apiKey` fisso |
| Config audio | `src/types/index.ts:106-112`, `src/core/config.ts:71-77` | `sttProvider/sttModel`, `ttsProvider/ttsModel/ttsVoice/ttsStyle`, `audioBaseUrl`, `sttApiKey/ttsApiKey` |
| Setup/doctor | `src/setup.ts:74-86`, `src/doctor.ts:193-227` | domande audio in setup e check "Audio provider raggiungibile" |
| REPL | `src/cli/repl.ts`, `voice-input.ts`, `voice-output.ts` | `/mic on\|off\|auto`, `/speak on\|off`, `/voice ...`, `/voice live`; cattura via comando configurabile + VAD, playback di sistema |
| Streaming/realtime | `src/audio/stream.ts`, `src/audio/realtime.ts` | pipeline VAD→STT→LLM→TTS con interruzione, e sessione Realtime WebSocket con barge-in |
| Policy audio | `src/audio/policy.ts` | `assertAudioToolAllowed`, `containsAudioData`, `stripAudioData` |
| Timbro identitario | `src/audio/identity.ts` | `ttsInstructionsFromProfile` / `resolveTtsInstructions` da `ProfileVoice` |
| Voice A/B audio | `src/benchmark/audio-voice-ab.ts`, `src/benchmark/alive.ts:20` | `audioIdentificationRate` in `AliveMetrics` |
| Canali | `src/gateway/`, `src/gateway/media-send.ts` | Web handlers, voice note Telegram/WhatsApp, `/voice` nei canali |

---

## 3. Cosa resta aperto

1. **Privacy non documentata** — `SECURITY.md` non ha ancora la sezione "Audio — biometrici e retention": audio greco non va nel ledger né nella memoria episodica, consenso esplicito prima dell'invio a provider remoti.
2. **Offline non self-contained** — il provider `local` (`src/audio/local.ts`) parla con un endpoint HTTP locale (`NTOX_LOCAL_STT_URL`/`NTOX_LOCAL_TTS_URL` o `audioBaseUrl`), non con modelli embedded whisper.cpp/Kokoro. Nessun byte esce, ma serve un processo separato.
3. **Latenza non misurata** — la telemetria end-of-speech → inizio risposta (target < 1 s Realtime / < 2 s locale) non è ancora esposta in `/trace`.
4. **Segnale audio secondario** — `audioIdentificationRate` è una metrica A/B, non ancora subordinata a `objectiveScore`/calibrazione nel senso del P0 di `road-to-self-truth.md`.
5. **Baseline di verifica** — la support matrix voce è già nel README e `npm run verify:all` passa 14/14 check, incluso lo scan del trust anchor (typecheck, lint, size, test, build, format, pack, smoke CLI/cognizione e adapter).

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

Stato aggiornato: Fasi 0–3 chiuse, Fase 4 parziale, Fase 5 parziale.

### Fase 0 — Chiudere la falla dei 401 — **fatta**

- [x] Campi audio in `NtoxConfig` (`src/types/index.ts:106-112`) e `ConfigSchema` (`src/core/config.ts:71-77`).
- [x] `sttTool`/`ttsTool` leggono chiave/endpoint dal provider audio (`resolveAudioFromConfig`), non da `config.apiKey`.
- [x] `src/setup.ts:74-86`: domande audio; `src/doctor.ts:193-227`: check provider raggiungibile.
- [x] Test `src/audio/audio.test.ts:30`: "uses the TTS key and model instead of the LLM key".

### Fase 1 — Provider audio — **fatta**

- [x] `src/audio/index.ts:7`: `resolveAudioProviders(config)` speculare al resolver LLM.
- [x] Adapter OpenAI, Groq, locale per STT; OpenAI, OpenRouter, locale per TTS.
- [x] `sttTool`/`ttsTool` delegano; test di contratto in `src/audio/audio.test.ts`, `policy.test.ts`, `realtime.test.ts`, `stream.test.ts`.
- [x] Nessun fallback local-hash: il provider `local` richiede un endpoint HTTP (vedi Fase 5).

### Fase 2 — Voce identitaria — **fatta**

- [x] `src/audio/identity.ts`: `ProfileVoice` → `ttsInstructions`, legato a `mind.profile`.
- [x] `ttsTool` accetta `instructions`; `synthesizeSpeech` passa quelle del profilo.
- [x] `handleVoiceCommand` (`src/gateway/voice-mode.ts:113-115`) con `voice`, `style`, `engine`.
- [x] `audioIdentificationRate` in `AliveMetrics` (`src/benchmark/alive.ts:20`) e `src/benchmark/audio-voice-ab.ts`.
- [x] Test `src/audio/audio.test.ts:79`: directness/verbosity → istruzioni TTS distinte.

### Fase 3 — Il REPL sente e parla — **fatta**

- [x] `src/cli/voice-input.ts`: cattura via comando configurabile (`NTOX_RECORD_COMMAND`) + VAD (`src/audio/vad.ts`); push-to-talk con Invio, non `Ctrl+Space`.
- [x] `src/cli/voice-output.ts`: playback del data URL TTS via player di sistema.
- [x] `/mic on|off|auto`, `/speak on|off`, `/voice ...`, `/voice live` in `src/cli/repl.ts`.
- [x] Il testo trascritto entra nello stesso percorso agent del testo digitato.
- [x] Test I/O voce in `src/cli/voice-io.test.ts`.

### Fase 4 — Conversazione full-duplex — **parziale**

- [x] Provider Realtime (`src/audio/realtime.ts`) con WebSocket, barge-in e interruzione.
- [x] Pipeline streaming locale (`src/audio/stream.ts`) con VAD → STT → LLM → TTS e interruzione.
- [x] `/voice live` per REPL e Web UI; canali messaggistica restano voice-note.
- [ ] Telemetria: latenza end-of-speech → inizio risposta, target < 1 s (Realtime) / < 2 s (locale).

### Fase 5 — Offline, sicurezza, documentazione — **parziale**

- [ ] Profilo `local` self-contained: oggi `src/audio/local.ts` parla con un endpoint HTTP locale, non con whisper.cpp/Kokoro embedded.
- [x] Policy microfono come tool: allowlist, `assertAudioToolAllowed`, redazione audio da `src/audio/policy.ts`.
- [ ] `SECURITY.md`: sezione "Audio — biometrici e retention".
- [x] README: support matrix con `Voice (REPL)` (`Core`) e `Voice (live)` (`Experimental`).
- [x] `npm run verify:all` verde — 14/14 gate, incluso lo scan del trust anchor (typecheck, lint, size, 1.760 test, build, format, pack, smoke CLI/cognizione, adapter typecheck/test/build/pack).

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
3. Telegram/WhatsApp/Web continuano a funzionare con i test attuali verdi — nessuna regressione nella suite.
4. Due profili con `directness` diversa sono distinguibili **all'ascolto** nel voice A/B audio.
5. `npm run verify:all` verde e README aggiornato con la support matrix voce.

---

## 11. Ordine di priorità consigliato

**Fase 0 → 1 → 2 → 3 → 5 → 4.** Le Fasi 0–3 sono chiuse: restano la Fase 5 (sicurezza/offline/verifica) e la telemetria della Fase 4. La latenza era il motivo per cui Realtime andava dopo l'audio affidabile — ora che l'audio è affidabile, misurarla è il prossimo passo.
