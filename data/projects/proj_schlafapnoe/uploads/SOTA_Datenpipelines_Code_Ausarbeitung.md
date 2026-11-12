# Technische Ausarbeitung: SOTA-Datenpipelines mit Open-Source-Code für Schlafapnoe & PSG-Datensätze

**Autor / Owner:** Laurin Engelen  
**Kontext:** Teamprojekt AIN (WS 2026/27) – HTWG Konstanz, Ubiquitous Computing Lab (Prof. Dr. Ralf Seepold, Dr. Giulia Maria Mattia, MSc Daniel Vélez)  
**Ziel:** Verständliche, praxisnahe Analyse existierender Open-Source-Datenpipelines (GitHub) auf Polysomnographie-Daten (SHHS, MESA, UCDDB, Apnea-ECG), Erläuterung aller zentralen Fachbegriffe in einfacher Sprache und Formulierung unseres finalen Umsetzungsplans für das KES-Paper und die Software.

---

## Inhaltsverzeichnis
1. **Das große Ganze: Die 5 Schritte einer Biosignal-Pipeline**
2. **Fachbegriffe einfach erklärt (Das „Spickzettel“-Kapitel)**
   * *AASM-Regeln & Schlafapnoe (Apnoe vs. Hypopnoe, AHI)*
   * *$\Delta\text{SpO}_2$ & der 3 %-Entsättigungs-Drop*
   * *Der $\text{SpO}_2$-Kreislauf-Lag (15–45s Verzögerung)*
   * *EKG-Zerlegung: R-Peak, RRI & EDR*
   * *Kubische Spline-Interpolation auf 1 Hz*
   * *RSA (Respiratorische Sinusarrhythmie): Zusammenspiel EDR & RRI*
   * *Atmungs-Envelope (Einhüllende) statt Punkt-Abtastung*
   * *Z-Score vs. Robust IQR-Scaling (Schutz vor dem Hospital Shift)*
   * *Modality Dropout vs. Sensor-Toggle (Die Nulllinien-Falle)*
   * *TRT vs. TST (Das Wake-Up-Problem von Alarcón et al.)*
   * *Data Leakage & Patient-Split (`GroupKFold`)*
   * *Class Imbalance: Weighted / Focal Loss vs. 50:50 Undersampling*
3. **Übersicht: 5 SOTA-Paper mit verifiziertem GitHub-Code**
4. **Wie lösen andere Paper die 5 Pipeline-Stufen im Code?**
5. **Kritische Abwägung: Eure bisherigen Folien 5 & 6 vs. SOTA-Code**
6. **Unser finaler Umsetzungsplan („Der Königsweg“)**

---

## 1. Das große Ganze: Die 5 Schritte einer Biosignal-Pipeline

Bevor ein neuronales Netz (z. B. ein 1D-CNN) erkennen kann, ob ein Patient im Schlaflabor gerade einen Atemaussetzer hat, müssen die Rohdaten einen 5-stufigen Vorbereitungsprozess durchlaufen:

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│ 1. Ingestion    │ ──► │ 2. Cleaning     │ ──► │ 3. Rescaling    │ ──► │ 4. Windowing    │ ──► │ 5. Modeling    │
│ EDF, XML, WFDB  │     │ Rauschen & Dips │     │ IQR-Normierung  │     │ 60s-Fenster     │     │ 1D-CNN, XAI     │
│ Kanäle mappen   │     │ R-Peaks, Spline │     │ pro Patient     │     │ Labeling (≥10s) │     │ Grad-CAM        │
└─────────────────┘     └─────────────────┘     └─────────────────┘     └─────────────────┘     └─────────────────┘
```

1. **Ingestion (Einlesen):** Rohdateien (`.edf`, `.xml`, `.dat`) von der Festplatte laden und chaotische Kanalnamen auf ein einheitliches System mappen.
2. **Cleaning & Transformation:** Rauschen rausfiltern, Sensorfehler bereinigen und schnelle Signale (EKG 250 Hz) in synchrone 1-Hz-Merkmale umwandeln.
3. **Rescaling (Normalisierung):** Alle Signale so skalieren, dass individuelle Unterschiede (Hautwiderstand, Sensor-Marke) ausgeglichen werden, ohne dass Bewegungsartefakte die Skala sprengen.
4. **Windowing & Labeling:** Die stundenlange Nacht in mundgerechte 60-Sekunden-Häppchen schneiden und jedem Fenster das Label `0` (Normal) oder `1` (Apnoe) zuweisen.
5. **Modeling & Evaluation:** Die sauberen Daten ins neuronale Netz füttern und mit 1D-Grad-CAM erklären, warum das Modell so entschieden hat.

---

## 2. Fachbegriffe einfach erklärt (Das „Spickzettel“-Kapitel)

Hier findest du alle wichtigen medizinischen und technischen Konzepte aus den Papern in einfacher, bildhafter Sprache erklärt.

---

### AASM-Kriterien: Was unterscheidet Apnoe von Hypopnoe?
Die **AASM** (*American Academy of Sleep Medicine*) ist die weltweite Fachgesellschaft, die die Regeln für Schlaflabore festlegt:
* **Obstruktive Apnoe (OSA):** Der Rachen fällt komplett zusammen. Der Atemfluss sinkt für **mindestens 10 Sekunden um $\ge 90\ \%$** ab, obwohl Bauch und Brust sich krampfhaft weiterbewegen.
* **Hypopnoe:** Der Rachen verengt sich nur teilweise. Der Atemfluss sinkt für **mindestens 10 Sekunden um $\ge 30\ \%$** ab **UND** es muss zwingend ein **Sauerstoffabfall um mindestens 3 %** ($\text{SpO}_2$-Drop) oder eine Aufwachreaktion im Gehirn (EEG-Arousal) folgen.
* **AHI (Apnoe-Hypopnoe-Index):** Der wichtigste Wert in der Schlafmedizin:
  $$\text{AHI} = \frac{\text{Gesamtzahl aller Apnoen und Hypopnoen}}{\text{Tatsächliche Schlafstunden (TST)}}$$
  * *Normal:* $\text{AHI} < 5$ | *Mild:* $5 \le \text{AHI} < 15$ | *Moderat:* $15 \le \text{AHI} < 30$ | *Schwer:* $\text{AHI} \ge 30$.

---

### $\Delta\text{SpO}_2$ & der 3 %-Entsättigungs-Drop (Baseline-Trick)
* **Das Problem:** Ein gesunder 20-Jähriger hat eine Sauerstoffsättigung von $98\ \%$. Fällt sein Wert bei einer Apnoe auf $95\ \%$, ist das ein gefährlicher **3 %-Drop**. Ein älterer Raucher hat vielleicht die ganze Nacht konstant $92\ \%$, atmet aber völlig frei (kein Drop). Ein einfaches KI-Modell, das nur auf den Absolutwert schaut, hält den gesunden Wert $95\ \%$ für unkritisch und die normalen $92\ \%$ des Rauchers fälschlicherweise für krank.
* **Die Lösung ($\Delta\text{SpO}_2$):** Man berechnet für jede Sekunde den Abstand zum höchsten Wert der letzten zwei Minuten (rollierende Baseline):
  $$\Delta\text{SpO}_2(t) = \max(\text{SpO}_2[t-120\text{s} \dots t]) - \text{SpO}_2(t)$$
* **Der Effekt:** Egal ob ein Patient bei $99\ \%$ oder bei $91\ \%$ startet: Bei normalem Atmen ist der Wert immer **$0$**. Sobald eine echte Entsättigung passiert, schlägt die Kurve als **scharfer Berg $\ge 3$** nach oben aus. Das neuronale Netz erkennt den Atemaussetzer sofort!

```
Patient A (98% Normal):   98% ──► 97% ──► 95% (Drop!) ──► ΔSpO2: 0 ──► 1 ──► 3 (Alarm!)
Patient B (92% Normal):   92% ──► 92% ──► 92% (Normal)──► ΔSpO2: 0 ──► 0 ──► 0 (Gesund!)
```

---

### Der $\text{SpO}_2$-Kreislauf-Lag (15–45s Verzögerung)
* **Was ist das?** Wenn du dir jetzt für 20 Sekunden die Nase zuhältst, fällt der Sauerstoffwert an deinem Zeigefinger **nicht sofort** ab. Das sauerstoffarme Blut muss erst von den Lungenbläschen ins Herz gepumpt werden und von dort durch die Schlagadern bis in deine Fingerspitze fließen.
* **Klinische Totzeit:** Diese Transportzeit dauert **15 bis 45 Sekunden**!
* **Konsequenz für unsere Pipeline:** Wenn wir kurze 10- oder 30-Sekunden-Fenster schneiden, liegt der Atemstillstand im ersten Fenster, der dazugehörige Sauerstoffabfall aber erst im nächsten Fenster! Mit **60-Sekunden-Fenstern** (wie bei Alarcón et al.) fangen wir Atemstopp und Sauerstoffabfall zuverlässig im selben Fenster ein.

---

### EKG-Zerlegung: R-Peak, RRI und EDR
Ein EKG misst elektrische Herzimpulse mit 250 Hz (250 Werte pro Sekunde). Der höchste Zacken jedes Herzschlags heißt **R-Zacke (R-Peak)**. Aus diesen Zacken holen moderne Pipelines zwei völlig unterschiedliche Signale heraus:

```
EKG-Rohsignal (250 Hz):
          ▲                   ▲                            ▲
          │ R-Peak 1          │ R-Peak 2                   │ R-Peak 3
      ────┼───────◄── RRI ───►┼───────◄────── RRI ────────►┼──────
          │    (z.B. 0.85s)   │            (z.B. 1.10s)    │
```

1. **RRI (R-R-Intervall = Schlagabstand):**  
   Der Zeitabstand zwischen zwei Herzschlägen (z. B. $0{,}85\text{s}$). Während einer Apnoe schlägt das Herz zunächst immer langsamer (**RRI wird lang**). Wenn der Patient nach Luft schnappt und aufwacht, rast das Herz plötzlich los (**RRI wird blitzartig kurz**). Dieses zyklische Muster nennt man in der Kardiologie *CVHR* (Cyclical Variation of Heart Rate).
2. **EDR (ECG-Derived Respiration = Atmung aus dem EKG):**  
   Die **Höhe (Amplitude)** der R-Zacke schwankt mit jedem Atemzug! Warum? Wenn du einatmest, bläht sich die Lunge mit Luft auf (Luft leitet Strom schlecht) und das Herz kippt um ein paar Millimeter nach unten. Dadurch sinkt die gemessene elektrische Spannung an der Brust-Elektrode. Wenn du ausatmest, steigt sie wieder. Verbindet man die Spitzen der R-Zacken, erhält man eine **vollwertige Atmungskurve – komplett ohne Brustgurt!**

---

### Kubische Spline-Interpolation auf 1 Hz
* **Das Problem:** Das Herz schlägt nicht nach einer festen Stoppuhr, sondern unregelmäßig: Schlag 1 kommt bei Sekunde $0{,}00$, Schlag 2 bei $0{,}85$, Schlag 3 bei $1{,}92$, Schlag 4 bei $2{,}60$. Wir haben also Messwerte zu völlig krummen Zeitpunkten. Unser 1D-CNN benötigt aber für jede Minute exakt **60 Werte im sauberen 1-Sekunden-Takt** ($1{,}0\text{s}, 2{,}0\text{s}, 3{,}0\text{s} \dots 60{,}0\text{s}$).
* **Was macht die Kubische Spline?** Sie legt eine mathematisch perfekt geschwungene, glatte Kurve (wie ein biegsames Gummiband) durch die unregelmäßigen Herzschlag-Punkte und tastet diese Kurve anschließend exakt bei jeder vollen Sekunde ab.
* **Ergebnis:** Ein riesiges 250-Hz-EKG (15.000 Punkte pro Minute) schrumpft ohne Informationsverlust auf **60 saubere Punkte pro Minute**, die perfekt zu unseren 1-Hz-Atmungs- und $\text{SpO}_2$-Kanälen passen!

```
Unregelmäßige Herzschläge:    ● (0.0s)      ● (0.85s)            ● (1.92s)     ● (2.60s)
                              \            /        \           /             /
Glatte Spline-Kurve:           \──────────/          \─────────/─────────────/
                                │          │          │         │
Ablesen im 1-Hz-Takt:          1.0s       2.0s       3.0s      4.0s  --> Exakt 60 Werte/Minute!
```

---

### RSA (Respiratorische Sinusarrhythmie): Wie EDR und RRI zusammenspielen
* **Was bedeutet das?** Unser Gehirn koppelt den Puls an die Atmung:
  * Beim **Einatmen** schlägt das Herz automatisch **schneller** (RRI wird kürzer).
  * Beim **Ausatmen** bremst der Vagusnerv das Herz ab, es schlägt **langsamer** (RRI wird länger).
* **Der geniale Nutzen für die Pipeline:**
  * **EDR** zeigt die **mechanische Bewegung** des Brustkorbs (bewegt sich die Lunge noch?).
  * **RRI** zeigt die **nervliche Stressreaktion** des Körpers (schlägt das Herz im Panik-Modus?).
  * Bei normalem Schlaf schwingen EDR und RRI friedlich im gleichen Takt. Bei einer Schlafapnoe bricht dieser Rhythmus völlig zusammen: Das EDR wird flach, während das RRI extreme Ausschläge zeigt.

---

### Atmungs-Envelope (Einhüllende) statt naiver Punkt-Abtastung
* **Das Problem:** Ein normaler Atemzug dauert etwa 4 Sekunden. Wenn du ein 10-Hz-Atmungssignal einfach plump auf 1 Hz herunternimmst (indem du stur jeden 10. Datenpunkt nimmst), triffst du in Sekunde 1 zufällig den Nulldurchgang, in Sekunde 2 die Spitze, in Sekunde 3 wieder den Nulldurchgang. Die Kurve beginnt im 1-Hz-Takt wild zu flackern (*Aliasing-Effekt*).
* **Die Lösung (Envelope / Einhüllende):** Man filtert das Signal zuerst (0.05–3.0 Hz) und berechnet dann für jede 1-Sekunden-Epoche die **Schwingungsbreite (Peak-to-Peak-Amplitude oder Standardabweichung)**.
* **Ergebnis:** Solange der Patient normal atmet, liegt die Amplitude stabil bei z. B. $1{,}0$. Flacht die Atmung ab (Hypopnoe), sinkt der Wert auf $0{,}3$. Hört die Atmung ganz auf (Apnoe), fällt die Amplitude auf $0{,}0$.

---

### Z-Score vs. Robust IQR-Scaling (Schutz vor dem Hospital Shift)
* **Was ist der Hospital Shift?** Ein Modell, das im Schlaflabor A (z. B. SHHS) mit $85\ \%$ Genauigkeit lief, bricht im Schlaflabor B (z. B. UCDDB) plötzlich auf $70\ \%$ ein, weil andere Sensoren, Verstärker oder Filter verwendet wurden.
* **Warum versagt der normale Z-Score ($z = \frac{x - \mu}{\sigma}$)?** Wenn sich ein Patient mitten in der Nacht einmal heftig im Bett umdreht, reißt der Atmungsgurt extrem aus (z. B. 100-facher Ausschlag). Dieser einzige Ausschlag verfälscht die Standardabweichung $\sigma$ der gesamten Nacht! Alle echten Atemaussetzer davor und danach wirken plötzlich winzig klein.
* **Die SOTA-Lösung aus U-Sleep (`RobustScaler`):** Man nutzt den **Median** (den mittleren Wert) und den **Interquartilsabstand (IQR = 75. Perzentil minus 25. Perzentil)** mit Schranken bei $\pm 20\text{ IQR}$:
  $$x_{\text{scaled}} = \text{clip}\left(\frac{x - \text{Median}(x)}{\text{IQR}(x)}, -20, +20\right)$$
  Da der Median und der IQR unempfindlich gegenüber extremen Ausreißern sind, bleiben die Atemsignale über alle Kliniken hinweg exakt gleich proportioniert.

---

### Modality Dropout vs. Sensor-Toggle (Die Nulllinien-Falle)
* **Was ist der Sensor-Toggle?** Unser Feature, mit dem der Nutzer in der Software Sensoren nach Belieben an- oder ausschalten kann (z. B. wenn er zu Hause nur einen Fingerclip ohne Brustgurt hat).
* **Die gefährliche Falle:** Wenn ein 7-Kanal-Netzwerk trainiert wird und wir im Testbetrieb den Airflow-Kanal einfach auf `0` (Nulllinie) setzen, denkt das Netzwerk: *„Flacher Atemfluss = Atemstillstand = schwere Apnoe!“* Das Modell schlägt permanent Fehlalarm!
* **Die zwei richtigen Lösungen:**
  1. **Modality Dropout im Training (Fayyaz et al., 2024):** Während des Trainings schalten wir bei jedem Durchlauf zufällig einzelne Kanäle auf `0`. So lernt das Netz: *„Wenn ein Kanal dauerhaft 0 ist, ist er einfach nicht angeschlossen – ignoriere ihn!“*
  2. **Preset-Checkpoints (Pragmatisch & sicher):** Wir trainieren für die 4 Stufen (Wearable 2ch, Home 4ch, Extended 5ch, Lab 7ch) jeweils ein winziges, eigenes Modell (Größe je nur ca. 1–2 MB). Wenn der User umschaltet, lädt die App im Hintergrund das perfekt passende Modell.

---

### TRT vs. TST (Das Wake-Up-Problem von Alarcón et al.)
* **TRT (Total Recording Time):** Die gesamte Zeit, die das Aufnahmegerät lief (z. B. 8 Stunden von 22:00 bis 06:00 Uhr).
* **TST (Total Sleep Time):** Die Zeit, die der Patient wirklich **geschlafen** hat (z. B. nur 5 Stunden, weil er 3 Stunden wach im Bett lag).
* **Das Problem von Alarcón et al. (Paper P4):** Das Modell wusste nicht, wann der Patient wach war. Wenn ein Patient wach im Bett liegt, atmet er unregelmäßig (Sprechen, Seufzen, Drehen). Das Modell hielt das für Apnoen. Zudem teilte Alarcón die Events durch 8 Stunden (TRT), was den echten AHI bei Patienten mit Schlafstörungen massiv verfälschte!

---

### Data Leakage & Patient-Split (`GroupKFold`)
* **Die Falle:** Wenn ein Patient 480 Fenster à 60 Sekunden hat und man diese Fenster zufällig auf Trainings- und Testdaten verteilt, landen Fenster desselben Patienten in beiden Töpfen. Das Modell lernt dann nicht *Apnoe*, sondern es erkennt einfach die *Stimme/Eigenart des Patienten* wieder. Die Genauigkeit auf dem Papier steigt um bis zu $10\ \%$, aber auf einem neuen Patienten versagt das Modell komplett!
* **Die Regel:** Immer **strikter Patient-Split** (`GroupKFold(groups=patient_id)`). Alle Fenster von Patient X landen entweder komplett im Training oder komplett im Test.

---

### Class Imbalance: Weighted / Focal Loss vs. 50:50 Undersampling
* **Das Problem:** In einer typischen Nacht sind $80\text{ bis }85\ \%$ aller Minuten normale Atmung und nur $15\text{ bis }20\ \%$ Apnoen.
* **Was Alarcón et al. taten (50:50 Undersampling):** Sie warfen einfach so viele gesunde Fenster weg, bis genauso viele gesunde wie kranke Fenster übrig waren.
* **Der Haken:** Dabei wirft man wertvolle Daten weg – vor allem schwierige Wach- und Dreh-Bewegungen. Im echten Einsatz erzeugt das Modell dann viele Fehlalarme.
* **Die bessere Lösung (Focal Loss / Weighted Loss):** Man behält **$100\ \%$ aller Daten** im Training, sagt dem Optimierer aber: *„Wenn du eine seltene Apnoe übersiehst, gibt das 4-mal so viel Punktabzug, als wenn du eine normale Minute falsch rätst!“*

---

## 3. Übersicht: 5 SOTA-Paper mit verifiziertem GitHub-Code

Diese Arbeiten behandeln **Polysomnographie-Daten (PSG)**, haben ihr Repository öffentlich geteilt und bilden die Basis für unsere Pipeline:

| # | Paper & Referenz | GitHub-Repository | PSG-Datensätze | Kernlösung der Pipeline im Code |
| :--- | :--- | :--- | :--- | :--- |
| **1** | **Fayyaz et al. (2024)**<br>*Missing or Noisy Modalities*<br>[arXiv:2402.17788](https://arxiv.org/abs/2402.17788) | [`healthylaife/apnea-missing-modality`](https://github.com/healthylaife/apnea-missing-modality) | NSRR PSG (`SHHS`, `CHAT`, `NCH`) | **Modality Dropout:** Trainiert das Netz darauf, beliebige Kanalausfälle ohne Absturz zu verkraften. |
| **2** | **Zhang et al. / Duc Thien (2025)**<br>*Efficient sleep apnea detection*<br>[PubMed](https://pubmed.ncbi.nlm.nih.gov/39642622/) | [`DejunZhang-Online/Sleep-apnea-detection`](https://github.com/DejunZhang-Online/Sleep-apnea-detection) | `UCDDB` (Voll-PSG), `Apnea-ECG` | **EKG-Splines (`prepare_ucddb.py`):** R-Peak-Detektion, RRI/EDR-Berechnung und Spline-Interpolation auf 1–3 Hz. |
| **3** | **Alarcón, Seepold et al. (2023)**<br>*OSA detection for portable monitor*<br>[PMC10157077](https://pmc.ncbi.nlm.nih.gov/articles/PMC10157077/) | NSRR Tools ([`github.com/nsrr`](https://github.com/nsrr)) + `mne` ([Paper lokal](file:///C:/Users/lauri/Meine%20Ablage/Privat/Bildungsweg/Studium/Semester%207/Teamprojekt/docs/Papers/Obstructive%20sleep%20apnea%20event%20detection%20using%20explainable%20deep%20learning%20models%20for%20a%20portable%20monitor.pdf)) | `SHHS1`, `SHHS2`, `MESA` | **1-Hz-Harmonisierung & Grad-CAM:** 4 Kanäle auf 1 Hz, Z-Score, 60s-Fenster (Event $\ge 10\text{s}$), 50:50 Split. |
| **4** | **Perslev et al. (2021) – U-Sleep**<br>*Resilient generalist DL model*<br>[PMC7809075](https://pmc.ncbi.nlm.nih.gov/articles/PMC7809075/) | [`perslev/U-Sleep`](https://github.com/perslev/U-Sleep) | 16 PSG-Kohorten (`SHHS`, `MESA`, `UCDDB`, etc.) | **Multi-Cohort Adapter & Robust Scaling:** Alias-Mapping über 16 Klinik-Formate; ersetzt Z-Score durch Median/IQR ($\pm 20$). |
| **5** | **Makowski et al. (2021) / NeuroKit2**<br>*Neurophysiological signal processing*<br>[DOI:10.3758/s13428-020-01516-y](https://doi.org/10.3758/s13428-020-01516-y) | [`neuropsychology/NeuroKit`](https://github.com/neuropsychology/NeuroKit) | `SHHS`, `UCDDB`, `Apnea-ECG` | **Fertige 1-Hz Feature-Extraktoren:** Python-Funktionen für R-Peaks, EDR-Atmung, HRV-Bänder und EEG-$\beta/\delta$-Power. |

---

## 4. Wie lösen andere Paper die 5 Pipeline-Stufen im Code?

### Stufe 1: Daten-Ingestion & Format-Chaos (EDF, XML, WFDB)
* **Code-Lösung (`U-Sleep`, `sleepyland`):**
  * Ein Adapter liest `.edf` (via `mne.io.read_raw_edf`) und `.dat` (via `wfdb.rdrecord`).
  * Ein **Alias-Dictionary** übersetzt Klinik-Kanalnamen automatisch: Egal ob ein Kanal `THOR RES` (SHHS), `Ribcage` (UCDDB) oder `Thorax` (MESA) heißt – im Code wird er einheitlich zu `THORAX`.
  * Aus den Startzeiten und Dauern der XML-Annotationen wird vorab eine durchgehende **1-Hz-Labelmaske** für die gesamte Nacht erzeugt.

### Stufe 2: Filterung & Raten-Harmonisierung (1 Hz vs. 250 Hz)
* **$\text{SpO}_2$ (1 Hz):** Werte $< 70\ \%$ oder Sprünge $> 4\ \%/\text{s}$ werden als Artefakt (`NaN`) markiert und über kurze Lücken ($\le 5\text{s}$) linear interpoliert. Zusätzlich wird $\Delta\text{SpO}_2$ berechnet.
* **EKG (250 Hz):** Bandpass (0.5–40 Hz) $\rightarrow$ R-Peak-Detektor $\rightarrow$ RRI & EDR $\rightarrow$ **Kubische Spline-Interpolation auf 1 Hz** (aus `prepare_ucddb.py`).
* **Atemgurte & Airflow (10–32 Hz):** Bandpass (0.05–3.0 Hz) $\rightarrow$ **1-Sekunden-Envelope (Peak-to-Peak-Amplitude)** statt naiver Einzelpunkt-Abtastung.
* **EEG (128–256 Hz):** Bandpass (0.5–40 Hz) $\rightarrow$ Kurzzeit-Spektralanalyse (Welch) zur Berechnung des 1-Sekunden-$\beta/\delta$-Arousal-Verhältnisses.

### Stufe 3: Patient-wise Normalisierung
* Anstelle des anfälligen Z-Scores setzen moderne Pipelines (`U-Sleep`) auf **Median / Interquartilsabstand (IQR)** mit Schranken bei $\pm 20\text{ IQR}$. Das gleicht Sensorunterschiede zwischen Laboren perfekt aus, ohne durch vereinzelte Bettdreh-Artefakte zerstört zu werden.

### Stufe 4: Windowing & $\text{SpO}_2$-Lag
* Verwendung von **60-Sekunden-Fenstern** mit Überlappung (z. B. 30s Stride).
* **Label-Regel:** Ein 60s-Fenster erhält `Label = 1 (Apnoe)`, wenn mindestens **10 zusammenhängende Sekunden** eines annotierten Events darin liegen. Das fängt sowohl das Atemeignis als auch den 15–45s verzögerten $\text{SpO}_2$-Abfall im selben Fenster ein.

### Stufe 5: Loss-Funktion & Leakage-Schutz
* Streng getrennter **Patient-Split (`GroupKFold`)**.
* Behalten von $100\ \%$ aller gesunden und kranken Fenster unter Einsatz von **Weighted Cross-Entropy** oder **Focal Loss**, um False Positives in Wachphasen drastisch zu reduzieren.

---

## 5. Kritische Abwägung: Eure bisherigen Folien 5 & 6 vs. SOTA-Code

Wenn wir eure bisherigen Folien 5 & 6 (*1 Hz Feature Alignment + Modular Sensor-Toggle + 60s Windowing + 1D-CNN*) mit den Codebases vergleichen, ergibt sich ein klares Bild:

### 3 Bestätigungen (Das ist in eurem Plan bereits goldrichtig):
1. **1-Hz-Feature-Alignment:** Schnelle Signale in aussagekräftige 1-Sekunden-Werte (RRI, EDR, Bandpower) umzurechnen, statt sie plump zu dezimieren, ist die sauberste Lösung. Jedes 60s-Fenster hat exakt die Form $(C \times 60)$ – perfekt für **1D-Grad-CAM**!
2. **60-Sekunden-Fenster:** Löst das $\text{SpO}_2$-Transportzeit-Problem (15–45s Verzögerung) elegant.
3. **Die 4 klinischen Presets (Folie 6):** Die Staffelung (Wearable $\rightarrow$ Home Monitor $\rightarrow$ Extended $\rightarrow$ Full Lab) liefert die perfekte Storyline für euer KES-Paper und die Software.

### 3 Upgrades (Hier solltet ihr nachjustieren):
1. **Sensor-Toggle sauber absichern:** Nicht einfach im Test Kanäle blind auf `0` setzen (Erstickungs-Illusion fürs CNN!), sondern entweder mit **Modality Dropout** trainieren oder für die 4 Presets 4 schlanke Modell-Checkpoints speichern.
2. **Atem-Envelope bei 1 Hz:** Bei Airflow und Gurten pro Sekunde die **Schwingungsbreite (Envelope)** nehmen, damit abgeflachte Hypopnoen bei 1 Hz nicht übersehen werden.
3. **Focal / Weighted Loss statt 50:50 Undersampling:** Alle Trainingsdaten behalten, um Fehlalarme bei Wachbewegungen zu minimieren.

---

## 6. Unser finaler Umsetzungsplan („Der Königsweg“)

Für euer Teamprojekt empfehlen wir folgenden konkreten 5-Stufen-Ablauf:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ 1. Unified Dataset-Adapter (mne / pyedflib / wfdb)                                     │
│    Liest SHHS & UCDDB, mappt Kanäle per Alias-Dictionary, baut 1-Hz-Labelmaske         │
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                            ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ 2. 1-Hz Feature-Alignment (7 standardisierte Kanäle)                                   │
│    • SpO2: Artefakt-Filter (<70%) + Delta-SpO2 (Drop zur 120s-Baseline)                │
│    • EKG (250 Hz): R-Peaks -> RRI (Pulsabstand) + EDR (Atmung) -> Spline auf 1 Hz      │
│    • Atmungsgurte & Airflow (10-32 Hz): Bandpass (0.05-3 Hz) -> 1s-Envelope            │
│    • EEG (128 Hz): Bandpass -> 1s Beta/Delta-Arousal-Verhältnis                        │
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                            ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ 3. Robust Scaling & 60s-Windowing                                                      │
│    • Pro Patient: Median / IQR Normalisierung (clip [-20, +20]) gegen Hospital Shift   │
│    • Schnitt in 60s-Fenster (Matrix: C x 60); Label = 1 falls Event >= 10s             │
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                            ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ 4. Smart Sensor-Toggle (4 klinische Stufen für das KES-Paper)                          │
│    • Preset 1 (Wearable, 2ch): SpO2 + HR_RRI                                           │
│    • Preset 2 (Home Monitor, 4ch): + Thorax & Abdomen (Alarcón-Baseline)               │
│    • Preset 3 (Extended, 5ch): + Airflow (+5-10% Genauigkeitssprung)                   │
│    • Preset 4 (Full Lab, 7ch): + EEG_C4 & EDR (Schutz vor Wach-Fehlalarmen)            │
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                            ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ 5. Patient-Split & Automatisierter Paper-Export                                        │
│    • GroupKFold nach Patienten-ID (kein Data Leakage!)                                 │
│    • Training mit Weighted Cross-Entropy (nutzt alle Wach- und Schlafdaten)            │
│    • Exportiert direkt KES-fertige Tabellen (Acc, Sens, Spec, LR+, AUC) und Grad-CAM  │
└────────────────────────────────────────────────────────────────────────────────────────┘
```
