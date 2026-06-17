# Public Landing UI Prototype

**Companion file:** [`landing.html`](./landing.html)  
**Status:** exploratory UI prototype, not implementation spec  
**Language:** Russian-first landing copy

---

## What We Created

We created a standalone HTML prototype for the public landing page of the crypto-funded therapy charity vault.

The selected direction is a **warm GitHub-like activity timeline**:

```txt
donations ─┐
receipts  ├─→ public ledger history → current HEAD
anchors   ┘
```

The landing explains the project through a simple public-history feed:

- money comes in as crypto donations;
- outgoing purchases become therapy gift-card receipts;
- daily proof anchors seal the ledger state;
- beneficiary identity is not shown.

This is intentionally **not** the full audit dashboard. The landing gives donors a readable first impression; the future dashboard can expose sortable tables, raw records, receipt details, hashes, and verification tooling.

---

## Chosen Visual Direction

### Name

**Warm multi-rail care feed**

### Core structure

```txt
┌────────────┬──────────────────────┬───────────────────────────────┐
│ date/time  │ graph rail           │ event card                    │
├────────────┼──────────────────────┼───────────────────────────────┤
│ 8 июн      │ donation lane ──┐    │ Anonymous donation + tx link  │
│ 10 июн     │ receipt lane  ──┼──→ │ Gift cards + receipt URL      │
│ 11 июн     │ proof lane    ──┘    │ Hash anchored on Solana       │
│ 14 июн     │ main ledger HEAD     │ Current public state          │
└────────────┴──────────────────────┴───────────────────────────────┘
```

The left rail has multiple lanes:

| Lane              | Meaning                                 |
| ----------------- | --------------------------------------- |
| **вход**          | incoming donations                      |
| **карты**         | outgoing gift-card purchases / receipts |
| **подтверждение** | daily hash anchors / public proof       |
| **реестр**        | main ledger history / current state     |

---

## Design Principles

### 1. Simple first, auditable second

The landing should be understandable without knowing crypto, Git, hash chains, or Solana.

Technical details are present, but secondary:

- `tx` links;
- `sha256` snippets;
- `HEAD` / `latest_hash`;
- receipt URLs;
- opaque beneficiary refs.

### 2. Warm charity tone, not cyberpunk crypto

We deliberately avoided a dark “crypto dashboard” aesthetic for the selected landing.

Chosen mood:

- warm off-white background;
- soft orange/green accents;
- rounded cards;
- human wording around care and sessions.

### 3. Public transparency without public identity

The UI should repeatedly reinforce this boundary:

```txt
public:  donations, receipts, hashes, amounts, dates
private: real names, Telegram IDs, contacts, therapy details
```

The prototype uses opaque refs like `ben-7x2`, never real beneficiary identity.

### 4. Landing preview, not full ledger product

This screen is a **preview of the trust model**. It should invite a donor to understand the system quickly.

The future full dashboard can contain:

- complete transaction table;
- filters by donation / receipt / anchor;
- receipt viewer;
- hash-chain verifier;
- Solscan links;
- export JSON / CSV.

---

## Copy Direction

The current Russian copy is intentionally soft and plain:

| UI text                                         | Intent                                           |
| ----------------------------------------------- | ------------------------------------------------ |
| **Живая история заботы.**                       | Main emotional frame: care, not finance.         |
| **Публичная история помощи**                    | Explains the feed without saying “ledger” first. |
| **Помочь оплатить сессии**                      | Direct donor CTA tied to therapy sessions.       |
| **Получатели остаются без имён и контактов.**   | Privacy promise in simple words.                 |
| **Любой может пересчитать публичный реестр...** | Honest technical trust affordance.               |

Technical labels (`tx`, `sha256`, `HEAD`, `latest_hash`) remain in English because they are standard verification language and would be awkward or less precise if translated fully.

---

## References And Inspiration

The final baseline was inspired mostly by **GitHub issue / PR timelines**:

```txt
left side: date + graph/event rail
right side: rich event card with metadata, links, status, comments
```

Additional inspiration:

- GitHub commit history density;
- Open Collective-style transparent finance vocabulary;
- Solscan / explorer-style transaction metadata;
- warm nonprofit / therapy visual language.

The important decision was to use GitHub-like structure **without** making the landing feel like a developer tool.

---

## Open Questions For Later

1. **Project name:** `Открытый фонд помощи` is placeholder wording.
2. **CTA wording:** “Помочь оплатить сессии” may be refined after legal / donor review.
3. **Russian/English split:** landing likely needs language switch, but prototype is Russian-first.
4. **Metadata density:** production landing may show fewer rows by default and link to the full dashboard.
5. **Receipt language:** decide whether to call them `чеки`, `квитанции`, or `подтверждения оплаты`.
6. **Verification wording:** needs careful wording so donors understand what the anchor proves and what it does not prove.

---

## Prototype Boundaries

This file is **not** final product code.

It does not define:

- frontend framework choice;
- component architecture;
- API contracts;
- real data model;
- accessibility implementation details;
- final legal/donor-facing copy.

It exists to preserve the selected visual and narrative direction before implementation planning.
