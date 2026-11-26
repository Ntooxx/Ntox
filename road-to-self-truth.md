# Road to Self Truth

**Obiettivo:** trasformare Ntox da un agente che *sembra* imparare a un agente che *dimostra* di imparare, ancorando ogni segnale di apprendimento a una verità esterna verificabile.

Documento di progetto — collegato al baseline `experiments/alive/2026-10-18-baseline.md`.

## Stato di implementazione

**Fatto e testato (typecheck pulito, lint 0 errori, suite di test verde):**

- P0 — `EvidenceProvenance` in `TurnSignals` (`src/mind/types.ts`), `objectiveScore` già supportato dal ledger (`src/mind/outcome-ledger.ts:42`), adapter `src/mind/evidence.ts` (`objectiveScoreFromResult`, `objectiveEvidenceFromResult`, `meaningfulObjective`, `buildEvidenceProvenance`), metriche oggettive in `LedgerStats` (`objectiveRows/objectiveRate/objectiveAvg`). `self-play.ts` usa l'adapter e registra la provenance.
- P0/P1 — gate nel kernel: `CognitiveKernel.requireEvidenceForPromotion` (default **on**): la critica euristica può regolare la forza dei pattern ma **non** promuove skill al registry; la promozione richiede `objectiveHits >= 3` (vedi `hasSufficientObjectiveEvidence`). `PatternStore.recordObjective` traccia le evidenze; `getAll()` per ispezione.
- P0 — canale dell'evidenza cablato: `runPostTurn` (`src/core/turn/post-turn.ts`) accetta `PostTurnInfo.objective`, lo passa a `NtoxCognitiveLayer.afterTurn` e a `kernel.process(query, response, objective)`, e lo registra nel ledger con provenance. I turni senza evaluator esterno passano `null`: non viene fabbricata evidenza.
- P2 — `src/evaluation/holdout.ts`: `splitHoldout` (split deterministico per fingerprint), `isHoldout`, `transferSummary`.
- P3 — `src/meta/autonomy.ts`: `enforceBudget` e `calibrationGuardrail` (blocca l'espansione se ECE peggiora mentre l'identità diverge).

**Resta da cablare (mancante per il giro completo):**

- Produrre `objectiveScore` nel turno conversazionale: l'unico produttore reale in-repo resta `self-play.ts`; le conversazioni normali non hanno ground truth e passano `null`. Servono check espliciti con artifact verificabile prima di contare su evidenza esterna nelle chat.
- Collegare `splitHoldout` all'esecuzione reale di `evaluation/curriculum.ts` + report ALIVE.
- Collegare `enforceBudget`/`calibrationGuardrail` a `idle`/`self-play`.

---

## 1. Tesi

Oggi il loop cognitivo si autovaluta con proxy:

- `src/cognition/critique.ts:25` calcola `completeness` come rapporto tra frasi della risposta e frasi attese.
- `src/cognition/critique.ts:38` calcola `accuracy` come `1 - hedging/parole`.
- `src/cognition/critique.ts:79` definisce `strengthened = completeness > 0.4 && accuracy > 0.3 && gaps.length === 0`.
- `src/cognition/kernel.ts:88-109` usa quel verdetto per rafforzare o indebolire pattern, e `compileCount >= 5` per compilarli in skill (`src/cognition/patterns.ts:9`).
- `src/cognition/cognitive-space.ts:208` (appena aggiunto) adatta i vettori dei domini dalla co-occorrenza osservata.

Failure mode: una risposta lunga e priva di esitazioni viene premiata anche se è sbagliata; una risposta breve e corretta viene indebolita. Il sistema amplifica il proprio rumore. Finché il giudice è interno, più "impara" e più si rassicura.

**Self truth = il credito arriva da un artefatto verificabile, non da una stima di sé.**

---

## 2. Cosa esiste già (da non ricostruire)

| Capability | File | Cosa offre |
|---|---|---|
| Segnale oggettivo | `src/mind/types.ts:28` | `TurnSignals.objectiveScore?: number` — previsto e già alimentato in `self-play.ts:64` (`objective.score * 2 - 1`), ma non ancora dal turno normale |
| Scoring | `src/mind/outcome-ledger.ts:41` | `scoreSignals`: se `objectiveScore` è definito ha priorità sui segnali euristici; `isScoreMeaningful` soglia `|score| >= 0.2` |
| Ledger | `src/mind/outcome-ledger.ts:46` | `OutcomeRow` con prediction, predictionError, score, cost, retries, banditReward; `COUNTERFACTUAL_KINDS = memory, theory, skill, pattern` |
| Valutatori | `src/evaluation/objective-evaluators.ts:9` | `CheckSpec` = `exact`, `containsAll`, `factRecall`, `constraints`, `numeric`, `command`; ritornano `ObjectiveResult { passed, score, detail }` |
| Critica con modello | `src/cognition/model-critique.ts`, usata in `src/core/turn/false-success.ts:1` | giudizio LLM per falsi successi — oggi non collegato al `Critic` del kernel |
| Firma delle evidenze | `src/memory/procedure-harness.ts:31` | Ed25519, chiave privata lato harness (0600), verifier ha solo la chiave pubblica; `verifyAndPromoteProcedure` lega `procedureId`, `currentVersion`, hash del contenuto, `taskId`, `envFingerprint`, `checkOutputs`; fallisce chiuso |
| Store verificato | `src/memory/procedure-store.ts` | promozione solo con evidenza firmata; policy deny dell'agent runtime su `PROCEDURES_DIR` |
| Bandit | `src/mind/bandit.ts` | selezione strategia per contesto `queryType:responseMode`, con exploration budget |
| Ciclo di vita skill | `src/skills/lifecycle.ts`, `src/meta/effectiveness.ts` | gestione/valutazione skill esistenti |
| Transfer | `src/research/transfer.ts` | `TransferStats { supported, rejected, avgLift, supportedRate }` |
| Curriculum | `src/evaluation/curriculum.ts` | famiglie di task (es. `correction-precedence`) |
| Metriche ALIVE | `src/benchmark/alive.ts:12` | `AliveMetrics`, `M5_TARGETS` (identityDivergence 0.4, transferLift 0.1, blindIdentification 0.6) |
| Studio del loop | `src/evaluation/loop-study.ts:38` | Brier score + 5 bin di calibrazione confidenza/qualità |
| Autonomia | `src/mind/idle.ts`, `spark.ts`, `interest.ts`, `self-play.ts` | cicli idle, curiosità, gioco con sé stessi |

---

## 3. I quattro pilastri

### P0 — Evidence-first scoring

**Principio:** nessun rafforzamento senza evidenza esterna.

- Alimentare `TurnSignals.objectiveScore` con `ObjectiveResult.score` prodotto da `src/evaluation/objective-evaluators.ts`.
- Estendere `OutcomeRow` (`src/mind/types.ts:46`) con una provenance dell'evidenza: `evaluator` (`exact` | `containsAll` | `factRecall` | `constraints` | `numeric` | `command` | `model-judge`), `artifactRef` (test/command/citazione), `envFingerprint`, `timestamp`.
- Regola di credito: `objectiveScore` ha priorità; se assente, il verdetto di `Critic` diventa **"needs verification"** e non può aumentare `pattern.strength` né innestrare `compile()`.
- `scoreSignals` continua a usare la soglia `0.2` di `isScoreMeaningful`: sotto soglia il turno non addestra.
- Il modello-giudice (`model-critique.ts`) resta un *secondo* giudice, non l'unico; il suo output deve essere a sua volta calibrato contro `objectiveScore`.

**Accettazione:** ogni pattern con `strength > 0.5` ha almeno 3 turni con `objectiveScore` significativo; zero promozioni basate solo sul conteggio frasi.

### P1 — Skill promosse solo se dimostrano

**Principio:** una skill è un programma con test, non un riassunto di una chiacchierata.

- `PatternStore.compile` (`src/cognition/patterns.ts:154`, gate `compileCount < COMPILE_THRESHOLD` a `:157`) restano, ma la promozione richiede in più: almeno 3 esiti oggettivi positivi in almeno 2 sessioni distinte.
- Per le skill procedurali usare `verifyAndPromoteProcedure` (`src/memory/procedure-harness.ts:88`): firma ED25519 su hash della versione + `taskId` + `envFingerprint` + `checkOutputs`. L'agent runtime non può firmare — import discipline già testata.
- `registry.add` in `src/cognition/kernel.ts:104` viene chiamato solo dopo il gate.
- `src/skills/lifecycle.ts` + `src/meta/effectiveness.ts`: pensionare (o degradare) le skill con tasso di successo oggettivo mobile sotto soglia su K tentativi; il ritiro è un evento registrato nel ledger, non una cancellazione silenziosa.

**Accettazione:** ogni skill compilata o procedura promossa ha evidenza firmata/verificabile collegata; nessun agent-runtime module importa `procedure-harness.ts`. Difeso automaticamente da `npm run check:trust-anchor` (`scripts/check-trust-anchor.mjs`), integrato in `npm run verify:all`: lo scan copre agent runtime, client e adapter, escludendo solo il signer e il lato harness di fiducia.

### P2 — Transfer misurato su held-out

**Principio:** senza un set che non viene mai usato per imparare, il miglioramento è una narrazione.

- Dividere le famiglie di `src/evaluation/curriculum.ts` in `train` e `holdout` usando una fingerprint stabile (stesso meccanismo di `AliveRun.fingerprintHash`, baseline `1594e1727aec06a7`).
- Nessuna riga held-out può entrare negli aggiornamenti di pattern, vettori (`learnFromCoOccurrence`), bandit o skill. Aggiungere un test che lo verifichi ispezionando `queryPreview`/taskId nel ledger.
- `src/research/transfer.ts`: `avgLift` su task mai visti; target `>= +10%` (`M5_TARGETS.transferLift = 0.1` in `src/benchmark/alive.ts:64`).
- Ogni run ALIVE stampa: fingerprint del set, id dei task held-out, `supported/rejected/avgLift`, e il report in `experiments/alive/<data>-self-truth.md`.

**Accettazione:** `transferLift >= 0.1` su almeno 2 fingerprint diverse, con il set held-out dichiarato nel report.

### P3 — Curiosità con budget

**Principio:** l'agente può scegliere cosa imparare, ma deve pagare e rendicontare.

- `idle`/`spark`/`interest`/`self-play` generano un curriculum autonomo di esperimenti sul proprio spazio cognitivo (domini poco coperti, pattern deboli, skill mai richiamate).
- Ogni ciclo ha un tetto di token/costo e deve produrre **o** un candidato di skill con evidenza **o** un risultato negativo registrato. Nessun risultato ambiguo.
- `AliveMetrics.autonomyYield = idle.yieldPerKToken` (`src/benchmark/alive.ts:122`) diventa la misura di produttività autonoma; target `> 0`.
- `identityDivergence` (`src/benchmark/alive.ts:113`, target `> 0.4`) viene letto come segnale di personalità emergente, con guardrail: se la divergenza cresce mentre `calibrationEce` peggiora, è deriva e va frenata.
- Nessuna azione autonoma che modifichi repository, lo stdin di altri processi o oltrepassi la policy del workspace.

**Accettazione:** almeno 5 cicli idle con budget rispettato, yield > 0, e ogni candidato o scarto tracciato nel ledger.

---

## 4. Metriche: baseline → target

| Metrica | Baseline (1 turno) | Target | Sorgente |
|---|---|---|---|
| Learning slope | n/a | > 0 | `src/benchmark/alive.ts:82` (`score` vs `seq`, richiede >= 4 righe) |
| Correction recurrence | 0 | -50% vs baseline | `mistakes.recurrenceRate` |
| Transfer lift | n/a | >= +10% | `M5_TARGETS.transferLift = 0.1` |
| Calibration ECE | 0.25 | < 0.15 | `deps.calibration.ece`, `src/benchmark/alive.ts:121` |
| Autonomy yield | Infinity | > 0 | `idle.yieldPerKToken`, `src/benchmark/alive.ts:122` |
| Identity divergence | 0.3375 | > 0.4 | `M5_TARGETS.identityDivergence = 0.4` |
| Cost per solved task | n/a | -25% | `src/benchmark/alive.ts:88` (score >= 0.2) |
| NCB overall | n/a | +10% relativo | `deps.ncbOverall` |

Nota: il baseline ha 1 solo turno, quindi quasi tutte le metriche sono `n/a`. Il primo traguardo è produrre un run con almeno 4 turni e un set held-out dichiarato.

---

## 5. Fasi di implementazione

### Fase 0 — Strumentazione (immediata)

- [ ] Aggiungere provenance dell'evidenza a `TurnSignals`/`OutcomeRow` (`src/mind/types.ts`).
- [ ] Adapter `ObjectiveResult` → `objectiveScore` in `src/evaluation/objective-evaluators.ts` + punto di callsite nel turno (`src/core/turn/`).
- [ ] **Mitigazione immediata:** `learnFromCoOccurrence` (`src/cognition/cognitive-space.ts:208`) resti attivo solo come segnale *provvisorio*: finché P0 non è pronto, non deve essere usato per promuovere skill. Registrare questa annotazione nel codice solo quando richiesto.
- [ ] Test: `objectiveScore` prevale sui segnali euristici; assenza di evidenza → nessun credito.

### Fase 1 — Calibrazione

- [ ] `Critic` declassato a rilevatore di "needs verification"; `kernel.ts:95-108` vincola il rafforzamento alla presenza di evidenza.
- [ ] Calcolo ECE dai 5 bin di `src/evaluation/loop-study.ts:85`, alimentato da `deps.calibration` in `collectAliveRun`.
- [ ] Target: `calibrationEce < 0.15` su >= 50 predizioni.

### Fase 2 — Promozione e ritiro

- [ ] Gate su `PatternStore.compile` + `registry.add`.
- [ ] `verifyAndPromoteProcedure` per le skill procedurali; import discipline già testata, non allentarla.
- [ ] Integrazione con `src/skills/lifecycle.ts` e `src/meta/effectiveness.ts` per il ritiro.
- [ ] Test: uno skill non può auto-firmare la propria evidenza.

### Fase 3 — Transfer

- [ ] Split train/held-out in `src/evaluation/curriculum.ts` con fingerprint.
- [ ] Report ALIVE con id del set held-out e `avgLift`.
- [ ] Test: nessuna riga held-out usata in addestramento.

### Fase 4 — Autonomia

- [ ] Budget e rendicontamento per `idle`/`self-play`.
- [ ] Guardrail divergenza identità vs calibrazione.
- [ ] Primo run "self truth" con metriche complete.

---

## 6. Rischi e anti-goal

- **Goodhart:** se l'unico bersaglio è `objectiveScore`, l'agente impara a compiacere il valutatore. Mitigazione: set held-out ruotati, più tipi di `CheckSpec`, comandi sempre in sandbox.
- **Reward hacking sulle skill:** l'agente non deve poter promuovere una procedura scrivendosi l'evidenza da solo — la firma ED25519 lato harness è il trust anchor, non un dettaglio opzionale.
- **Rumore amplificato:** l'adattamento dei vettori appena introdotto è pericoloso se alimentato da critica euristica; va trattato come provvisorio finché P0 non è operativo.
- **Costo:** ogni verifica aggiunge strumenti e token; il budget per ciclo autonomo e per turno deve essere esplicito e misurato da `costPerSolvedTask`.
- **Non obiettivo:** più skill nel library. Una skill in meno ma verificata batte dieci skill compilate su una stima di completezza.

---

## 7. Definition of done

Un run ALIVE con:

1. >= 4 turni e set held-out dichiarato nel report;
2. `learningSlope > 0`, `calibrationEce < 0.15`, `transferLift >= 0.1`;
3. ogni skill promossa con evidenza verificabile/firmata e ogni ritiro tracciato;
4. report generato in `experiments/alive/<data>-self-truth.md` con la tabella metriche compilata.
