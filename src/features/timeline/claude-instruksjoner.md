# Instruksjoner til Claude: oppdatere Skytale-tidslinjen

Du har fått denne filen sammen med `skytale-telenor-plan.json` — en eksport av den delte
tidslinjeplanen fra SkyTracker (`/timeline`). Brukeren vil at du redigerer JSON-filen på
bakgrunn av dokumentasjon, møtenotater eller beskjeder, og importerer den tilbake i verktøyet
etterpå. **Importen viser alltid en forhåndsvisning** av endringene dine før noe lagres, og
**all versjonering håndteres automatisk** — du skal aldri lese eller endre feltene `fv`,
`deleted`, `editedBy` eller `editedAt`. La dem stå som de står.

## Tidsmodellen

Alle tidspunkter er **flyttall i måneder siden 1. august 2026**. Aksen dekker 17 måneder
(august 2026 – desember 2027).

| Verdi | Betyr |
|---|---|
| `0` | 1. august 2026 |
| `1.5` | medio september 2026 |
| `5` | 1. januar 2027 |
| `17` | slutten av desember 2027 |

Bruk steg på `0.25` (≈ én uke) i hovedplanen og `0.125` i delmål.

## Datamodellen

```json
{
  "lanes": [{ "key": "produkt", "name": "Produkt" }],
  "tasks": [{
    "id": "unik-id",
    "lane": "produkt",
    "label": "Navn på oppgaven",
    "start": 1.0,
    "end": 2.5,
    "deps": ["id-som-må-bli-ferdig-først"],
    "subtasks": [{ "id": "sub-id", "label": "Delmål", "start": 1.0, "end": 1.5 }],
    "milestone": false,
    "t2": false,
    "status": "gronn",
    "statusCause": null,
    "statusAt": null,
    "dod": "Definisjon av ferdig (kun milepæler)",
    "links": [{ "label": "Beslutningsreferat", "url": "https://…" }],
    "buffer": 4,
    "cost": 250000,
    "revenue": 1000000
  }]
}
```

De fem siste feltene er **valgfrie**:
- `dod` — definisjon av ferdig, kort prosatekst. Kun meningsfull på milepæler.
- `links` — dokumentlenker (beslutninger, referater, spesifikasjoner).
- `buffer` — antall **uker** buffer reservert før milepælens måldato (føring 1.5).
  Kun på milepæler.
- `cost` — estimert kostnad i NOK. Kan settes på enhver oppgave; baner og milepæler
  summeres automatisk (milepælens kost = egen + hele avhengighetskjeden).
- `revenue` — forventet inntjening i NOK. Mest meningsfull på milepæler/leveranser.
  Både kost og inntjening vises alltid som **estimater** i verktøyet — sett dem bare når
  dokumentasjonen gir grunnlag for tallet, og rund heller av enn å dikte presisjon.

## Regler

- **`deps` er finish-to-start:** verktøyet dytter avhengige oppgaver framover til
  `start >= max(deps.end)`. Lag aldri sirkulære avhengigheter.
- **Delmål styrer:** har en oppgave `subtasks`, er `start`/`end` avledet (min/max av
  delmålene). Sett dem konsistent — verktøyet regner uansett om.
- **Statussignal:** `status` er `"gronn"` (som avtalt), `"gul"` (utfordringer) eller
  `"rod"` (krever beslutning). Ved gul/rød skal `statusCause` være **én av de seks faste
  kategoriene** — fritekst er forbudt:
  1. Undervurdert kompleksitet
  2. Avhengighet til andre
  3. Fravær eller kapasitetstap
  4. Omfang lagt til underveis
  5. Ekstern blokkering
  6. Omarbeid som følge av kvalitet
  Sett `statusAt` til nåværende tidspunkt (ISO) når du endrer status.
- **Rader merket `"source": "skytracker"` er speil** av SkyTracker-tavlen og skal ikke
  redigeres — endringer der gjøres i selve SkyTracker. Utelater du dem fra filen, bevares
  de automatisk ved import (de slettes ikke).
- **Id-er:** behold eksisterende `id` på rader som består; finn på nye, korte id-er for nye
  rader. Slette en rad = fjern den fra `tasks` — importen håndterer resten.
- **`t2: true`** betyr «forutsetter Telenor transje 2»; **`milestone: true`** gir pilleform;
  **`ext: true`** betyr at raden vises i investorpresentasjonen — sett den aldri på
  sensitivt innhold uten at brukeren ber om det.
- Norske labels, korte og skannbare.

## Arbeidsflyt

1. Les `skytale-telenor-plan.json` og dokumentasjonen brukeren peker på.
2. Gjør endringene i JSON-en (samme fil eller en ny — si tydelig hvor resultatet ligger).
3. Oppsummer for brukeren hva du endret og hvorfor, med henvisning til kilden.
4. Be brukeren trykke **Importer** i tidslinjeverktøyet og velge filen — forhåndsvisningen
   viser da nøyaktig hva som endres, og brukeren bekrefter med «Bruk endringene».
