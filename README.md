# Projekttavlen (Power Apps code app)

The Projekttavlen board as a Power Apps code app, with its data in Dataverse. It is ported from `../projekttavlen-main` (Cloudflare/vinext).

- `src/App.tsx`: the board UI, almost unchanged from the original
- `src/lib/board-store.ts`: the data layer. It talks to Dataverse through the Power Apps SDK once data sources are added. Until then it falls back to browser storage so `npm run dev` works offline.
- `scripts/provision-dataverse.mjs`: creates the publisher, solution and tables (safe to re-run)

## Dataverse model

| Table | Columns |
|---|---|
| `i8pb_project` (Projekt) | `i8pb_name` |
| `i8pb_task` (Opgave) | `i8pb_name` (task type name), `i8pb_project` (lookup, cascade delete), `i8pb_type`, `i8pb_phase`, `i8pb_status` (choices, values 100000000 + index), `i8pb_responsible` (text), `i8pb_due` (date only), `i8pb_hours` (decimal) |

Everything is created in the unmanaged solution **Project Board** (unique name `ProjectBoard`, publisher **itm8 Project Board**, prefix `i8pb`).

## Setup

Prerequisites: code apps enabled in the environment (Power Platform admin center → Environments → Settings → Product → Features), and the Azure CLI plus the Power Platform CLI (`pac`).

```bash
npm install
az login --allow-no-subscriptions
node scripts/provision-dataverse.mjs https://<org>.crm4.dynamics.com
pac auth create --environment https://<org>.crm4.dynamics.com
pac code init --displayName "Projekttavlen"
pac code add-data-source -a dataverse -t i8pb_project
pac code add-data-source -a dataverse -t i8pb_task
```

## Run and publish

```bash
npm run dev          # local, against Dataverse once data sources are added
npm run build
pac code push
```

Users need a Power Apps Premium licence (or pay-as-you-go/App Pass) and a security role with access to the two tables.
