# RMC sheet generator

Generates cascading multi-stage **raw-material cost (RMC)** workbooks for Krebs API
products, matching the `PHE RMC.xlsx` format. Each stage rolls its materials up to a
cost per kg of final API; the prior intermediate enters the next stage at its rolled-up
cost (no double counting).

## Run

Requires Node and two libraries (not part of this repo's runtime deps):

```bash
npm install exceljs hyperformula
node tools/rmc/build_rmc.cjs "RMC Workbook.xlsx"   # output path optional; defaults to ./RMC Workbook.xlsx
```

The script computes the whole model in HyperFormula first, fails on any formula error,
and embeds cached results so the file opens correct and live-recalculates in Excel
(`fullCalcOnLoad`).

## Output tabs

- **README** — column meanings, SAP-dump → column mapping, colour key.
- **PHE (real)** — verified reproduction of Phenylephrine (4 stages), ₹4140.05/kg.
- **Ibuprofen / Pregabalin / Complex API** — 2-, 5- and 10-stage worked examples using
  **assumed illustrative** numbers (clearly flagged). Replace with real SAP values.

## Columns

| Col | Meaning |
|-----|---------|
| D | Qty/batch (input) |
| E | `%rec` solvent recovery; fresh `F = D*(1-%rec)` |
| G | stage CC = `D / stage output` (× `(1-%rec)` if recovered) |
| H | product CC = `G` on final stage, else `G × downstream stage-input H` |
| I | Price (a "Stage-n Input" row links to `J` of the prior stage output) |
| J | Stage Cost `=G*I`, summed per stage |
| K | Product Cost `=H*I`; final output `K` = Σ all item `K` = RM cost / kg API |

Blue cells = hardcoded inputs to edit; black = formulas.

## Wiring real SAP data

Replace the `ibuprofen` / `pregabalin` / `complexApi()` product definitions with parsed
SAP rows (one stage block per intermediate), then re-run. `PHE (real)` is a literal
transcription and can stay as the reference.
