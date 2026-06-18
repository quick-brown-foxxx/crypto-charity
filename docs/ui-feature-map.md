# UI Feature Map — Open Care MVP Frontend

Complete inventory of every screen, section, interactive element, data display,
and state in the current MVP UI. All text is in Russian. Use this as the
baseline feature set for the design phase.

---

## 1. Global Layout

### 1.1 Header (Topline) — present on all pages

**File:** `src/routes/+layout.svelte`

| Element    | Description                                                                                                                            |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Brand link | `◦ Открытый фонд помощи` — links to `/`                                                                                                |
| Nav links  | 6 links: `Помочь` (/donate), `История` (/ledger), `Проверить` (/verify), `О проекте` (/about), `Вопросы` (/faq), `Контакты` (/contact) |
| Responsive | Nav links hidden below 980px                                                                                                           |

### 1.2 Footer — present on all pages

| Element      | Description                                          |
| ------------ | ---------------------------------------------------- |
| Version line | `Open Care v{DEPLOY_VERSION}` — muted text, centered |

### 1.3 Error page

**File:** `src/routes/+error.svelte`

| Element     | Description                                                                  |
| ----------- | ---------------------------------------------------------------------------- |
| Title       | `Ошибка {status}` or `Произошла ошибка`                                      |
| Lead text   | `Произошла непредвиденная ошибка. Пожалуйста, попробуйте обновить страницу.` |
| CTA buttons | `На главную` (primary, → /), `Сообщить о проблеме` (secondary, → /contact)   |

---

## 2. Public Pages

### 2.1 Landing Page (`/`)

**Files:** `src/routes/+page.svelte`, `src/routes/+page.ts`

**Data sources (SSR + client):** `GET /api/totals`, `GET /api/ledger-events?limit=10`, `GET /api/verify`

**Layout:** Two-column hero grid (0.74fr left, 1.26fr right). Stacks to single column below 980px.

#### Left Column — Hero + Metrics

| Element          | Description                                                                                                                   |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Kicker           | `Публичная история помощи` with green dot indicator                                                                           |
| H1               | `Живая история поддержки.`                                                                                                    |
| Lead paragraph   | Explains donations, card purchases, daily anchors converge into one public history. Recipients' names/contacts not disclosed. |
| CTA buttons      | `Помочь оплатить сессии` (primary, → /donate), `Посмотреть историю` (secondary, → /ledger)                                    |
| Metric cards (3) | Grid of 3 bordered cards:                                                                                                     |
| — Metric 1       | `Доступно` → `{balance_usdc_minor} USDC`                                                                                      |
| — Metric 2       | `Оплачено` → `{disbursements_count} выплат`                                                                                   |
| — Metric 3       | `Подтверждение` → `закреплено` or `ожидается` (based on anchor presence)                                                      |

**States:**

- **Loading:** Metrics show `—` placeholders
- **Loaded:** Live values from API
- **Error:** Not shown on landing (SSR fallback)

#### Right Column — Timeline Feed

| Element            | Description                                                                     |
| ------------------ | ------------------------------------------------------------------------------- |
| Feed header        | `Публичная история` + total event count (`{donations + disbursements} событий`) |
| Timeline component | Multi-rail timeline showing last 10 events (see §4.1)                           |
| Head row           | `сейчас` — current public state: balance, HEAD sequence number, latest hash     |

**States:**

- **Loading:** `Загрузка...` centered text
- **Error:** `Не удалось загрузить историю.` + `Повторить` button
- **Empty:** `Пока нет событий.`
- **Loaded:** Timeline with events + head row

---

### 2.2 Donate Page (`/donate`)

**File:** `src/routes/donate/+page.svelte`

**Data:** Static (hardcoded devnet addresses). No API calls.

**Layout:** Single column, max-width 48rem, vertical card stack.

#### Cards (in order):

| Card                             | Elements                                                                                                                                                                                                       |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Devnet warning** (conditional) | Amber border. Badge `⚠ Тестовая сеть`. Text explaining devnet-only validity. Hidden on mainnet.                                                                                                                |
| **Network & Token**              | H2 `Сеть и токен`. DL grid: `Сеть` → `Solana {cluster}`, `Токен` → `SPL USDC`, `Mint-адрес` → `<code>` + CopyButton                                                                                            |
| **Vault Address**                | H2 `Адрес хранилища`. Instruction text. Address in `<code>` + CopyButton. QR code (180px SVG, dynamic import). Treasury address in muted text.                                                                 |
| **Instructions**                 | H2 `Инструкция`. Numbered list: 4 steps (open wallet, select USDC, send to ATA, wait for ledger confirmation).                                                                                                 |
| **Warnings**                     | Amber border. H2 `Важные предупреждения`. 3 subsections: `Публичность блокчейна` (donor address visible on Solscan), `Memo-поле` (don't put names/contacts), `Каноничность` (ledger is canonical, not wallet). |
| **Troubleshooting**              | H2 `Пожертвование не появилось?`. Text + bullet list: check token/address, check Solscan, contact with tx signature. Links to /ledger and /contact.                                                            |

**Interactive elements:**

- 2× CopyButton (mint address, vault ATA address)
- 1× QR code (dynamic SVG generation via `qrcode` library)

---

### 2.3 Ledger Page (`/ledger`)

**Files:** `src/routes/ledger/+page.svelte`, `src/routes/ledger/+page.ts`

**Data sources:** `GET /api/ledger-events?limit=50` (SSR + client), `GET /api/verify` (SSR + client)

**Layout:** Single column, max-width 56rem.

#### Sections (in order):

| Section         | Elements                                                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Page header** | H1 `Реестр`. Lead text explaining hash chain.                                                                             |
| **HEAD info**   | Card with full HEAD hash (HashDisplay) + sequence number `#{n}`. Or `Реестр пуст. HEAD появится после первой записи.`     |
| **Export link** | `Экспорт JSON (API) ↗` button linking to `{baseUrl}/api/ledger-events`                                                    |
| **Filter tabs** | 5 chip-style tabs: `Все`, `Пожертвования`, `Выплаты`, `Якоря`, `Коррекции`. Active tab is inverted (dark bg, light text). |
| **Rail labels** | Column headers: empty, `вход` / `выплаты` / `якоря` / `реестр` (mini rail), `детали события`                              |
| **Event list**  | Multi-rail timeline (see §4.1 inline variant). Each row is a clickable link to `/ledger/{eventHash}`.                     |
| **Pagination**  | `Загрузить ещё` button (appears when `nextCursor !== null`). Shows `Загрузка...` while loading more.                      |

**Event row content (per event type):**

| Event type              | Title                                                        | Amount display           | Meta                                                                                                                |
| ----------------------- | ------------------------------------------------------------ | ------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `donation_confirmed`    | `Пожертвование · {wallet_name}` or `Анонимное пожертвование` | `+{amount} USDC` (green) | SolscanLink (tx), hash (truncated)                                                                                  |
| `disbursement_recorded` | `Выплата · {provider} ×{count}`                              | `−{amount} USDC` (amber) | receipt_ref, beneficiary ref                                                                                        |
| `anchor_published`      | `Хэш реестра закреплён в Solana`                             | `#{seq}`                 | SolscanLink (anchor tx), hash. Extra note: `Любой может пересчитать публичный реестр и сравнить хэш с этим якорем.` |
| `correction_recorded`   | `Коррекция: {reason}`                                        | `#{seq}`                 | hash                                                                                                                |

**States:**

- **Loading:** `Загрузка...`
- **Error:** Card with error message + `Повторить` button
- **Empty (no events):** `Пока нет событий в реестре.`
- **Empty (filtered):** Shows 0 count in feed head, no rows
- **Loaded:** Event rows + pagination button if more available

---

### 2.4 Event Detail Page (`/ledger/[eventHash]`)

**File:** `src/routes/ledger/[eventHash]/+page.svelte`

**Data source:** `GET /api/ledger-events?limit=500` (client-side, finds matching event by hash)

**Layout:** Single column, max-width 48rem.

#### Sections (in order):

| Section                        | Elements                                                                                                                                                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Back link**                  | `← Назад к реестру`                                                                                                                                                                                                 |
| **Invalid hash** (conditional) | `Неверный хеш` + explanation (must be 64-char hex)                                                                                                                                                                  |
| **Not found** (conditional)    | `Событие не найдено` + full hash display                                                                                                                                                                            |
| **Event header**               | H1 `Событие #{sequence_no}`                                                                                                                                                                                         |
| **Detail grid**                | DL grid: `Тип` (Badge), `Номер` (#seq), `Сумма` (if present), `Хеш события` (full HashDisplay), `Предыдущий хеш` (full HashDisplay), `Создано` (formatted date), `Транзакция` (SolscanLink if tx_signature present) |
| **Hash chain context**         | H2 `Хеш-цепочка`. Explanation of prev_hash linking. For anchors: extra note about pre-anchor HEAD.                                                                                                                  |
| **Payload JSON**               | H2 `Данные события (payload)`. Pretty-printed JSON in dark code block (max-height 400px, scrollable).                                                                                                               |

**Badge variants by event type:**

- `donation_confirmed` → green
- `disbursement_recorded` → amber
- `anchor_published` → blue
- `correction_recorded` → purple

**States:**

- **Invalid hash:** Error card
- **Loading:** `Загрузка...`
- **Error:** Card with error + `Повторить` button
- **Not found:** Card with full hash
- **Loaded:** Full detail view

---

### 2.5 Verify Page (`/verify`)

**Files:** `src/routes/verify/+page.svelte`, `src/routes/verify/+page.ts`

**Data source:** `GET /api/verify` (SSR + client)

**Layout:** Single column, vertical card stack.

#### Sections (in order):

| #   | Section                                    | Elements                                                                                                                                                                                                                                              |
| --- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Page header**                            | H1 `Проверка реестра`. Lead text about independent verification via hash chain and Solana anchors.                                                                                                                                                    |
| 2   | **Current HEAD**                           | Prominent card (2px title-color border). H2 `Текущий HEAD реестра`. Explanation of HEAD. Full HashDisplay with `HEAD #{seq}` label. Or empty state: `Реестр пуст.`                                                                                    |
| 3   | **Pre-anchor explanation**                 | Amber-background info card. `ℹ️ Якорь фиксирует HEAD реестра, существовавший ДО публикации якоря.`                                                                                                                                                    |
| 4   | **Latest anchor**                          | H2 `Последний якорь`. DL grid: `Дата якоря`, `Зафиксированный HEAD` (HashDisplay), `Memo` (code + CopyButton), `Транзакция` (SolscanLink), `Адрес якорного кошелька` (code + CopyButton), `Опубликован` (date). Or empty: `Якорь ещё не опубликован.` |
| 5   | **Anchor staleness warning** (conditional) | Amber border card. Badge `⚠ Предупреждение`. Text: anchor >25h stale, possible cron issue, integrity not compromised.                                                                                                                                 |
| 6   | **Previous anchors**                       | H2 `Предыдущие якоря`. Table: columns `Дата`, `HEAD хеш` (HashDisplay), `Транзакция` (SolscanLink). Or empty: `Предыдущих якорей нет.`                                                                                                                |
| 7   | **Verification instructions**              | H2 `Инструкции по проверке`. TypeScript verification code in dark code block (max-height 24rem, scrollable). Or fallback text about manual verification.                                                                                              |
| 8   | **Export**                                 | H2 `Экспорт данных`. Text + `Скачать полный реестр (JSON) ↗` button linking to API. Empty-state note if no HEAD.                                                                                                                                      |
| 9   | **Troubleshooting**                        | H2 `Решение проблем`. Bullet list: hash mismatch → contact, anchor missing → check hash chain manually, anchor stale → no data integrity impact.                                                                                                      |

**States:**

- **Loading:** 3 skeleton cards (lg, md, sm sizes) with pulse animation
- **Error:** Red-bordered card with localized error message, request ID, `Попробовать снова` button
- **Loaded:** All sections as above

---

### 2.6 About Page (`/about`)

**File:** `src/routes/about/+page.svelte`

**Data:** Static. No API calls.

**Layout:** Single column, max-width 48rem.

#### Sections:

| Section                     | Content                                                                                                                             |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| H1                          | `О проекте`                                                                                                                         |
| **What is Open Care**       | H2 + paragraph: transparent charity platform on Solana, therapy session funding, public traceability + recipient privacy            |
| **Process flow**            | H2 `Как устроен процесс`. 5-step numbered list: donor → system → operator → bot → ledger/anchor                                     |
| **Manual conversion cycle** | H2 `Ручной цикл конвертации`. Bullet list: operator tracks balance, buys certificates, records receipts. Automation is future goal. |
| **Wallet separation**       | H2 `Разделение кошельков`. Treasury wallet (USDC) vs anchor wallet (SOL for fees).                                                  |
| **Recipient privacy**       | H2 `Почему получатели оставаются приватными`. `benpub_...` refs only, Telegram IDs never published.                                 |
| **Footer links**            | `Проверить реестр →` (/verify), `Частые вопросы →` (/faq)                                                                           |

---

### 2.7 FAQ Page (`/faq`)

**File:** `src/routes/faq/+page.svelte`

**Data:** Static. No API calls.

**Layout:** Single column, max-width 48rem.

#### Questions (each H2 + answer):

| Question                                   | Key points                                                                                                                    |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| **Что доказывают хеши?**                   | Hash chain proves sequence integrity, not receipt authenticity                                                                |
| **Что доказывают якоря?**                  | Solana memo anchors HEAD at a point in time. Pre-anchor HEAD caveat.                                                          |
| **Что НЕ доказывают чеки?**                | Receipt ref doesn't prove authenticity. Honest limitation.                                                                    |
| **Почему переводы видны в Solana?**        | Blockchain is public by nature. Donor address visible on Solscan.                                                             |
| **Почему данные Telegram не публикуются?** | Bot boundary: IDs/names stay inside bot. Only `benpub_...` in ledger.                                                         |
| **Почему оператор — ручной?**              | MVP limitation: manual certificate purchase. API integration is future goal.                                                  |
| **Как сообщить о проблеме?**               | Via /contact. Required info: tx signature, event hash, time, description. Forbidden: Telegram IDs, names, codes, seeds, keys. |

---

### 2.8 Contact Page (`/contact`)

**File:** `src/routes/contact/+page.svelte`

**Data:** Static. No API calls.

**Layout:** Single column, max-width 48rem.

#### Sections:

| Section              | Content                                                                                                           |
| -------------------- | ----------------------------------------------------------------------------------------------------------------- |
| H1                   | `Контакты`                                                                                                        |
| **Report a problem** | H2 + paragraph                                                                                                    |
| **What to include**  | Bullet list: tx signature, event hash, page URL, approximate time, description                                    |
| **What NOT to send** | Bullet list: Telegram ID, names, contacts, certificate codes, seed phrases, private keys, passwords, tokens       |
| **How to contact**   | `Создать issue на GitHub ↗` — external link to GitHub issues. Warning about not posting secrets in public issues. |

---

## 3. Admin Pages (Token-Gated)

**Auth flow:**

1. All `/admin/*` routes wrapped in `admin/+layout.svelte`
2. If no token → `TokenGate` component (password input + test via `GET /tg/internal/pending-requests`)
3. If token valid → `AdminNav` + child page
4. Token is memory-only (`$state`), never persisted. 30-min idle timeout. Cleared on 401, reload, logout.
5. User activity (click, keypress, scroll, mousemove) resets idle timer.

### 3.1 TokenGate

**File:** `src/lib/components/admin/TokenGate.svelte`

| Element        | Description                                                                             |
| -------------- | --------------------------------------------------------------------------------------- |
| Card           | Max-width 28rem, centered. H2 `Вход для оператора`.                                     |
| Info text      | `Токен не сохраняется. При перезагрузке страницы потребуется ввести заново.`            |
| Password input | `form-input`, placeholder `Введите токен оператора`, autocomplete off                   |
| Error display  | `form-error` styled text (appears on auth failure)                                      |
| Submit button  | `Войти` (primary). Shows `Проверка...` while checking. Disabled when empty or checking. |

**States:**

- **Idle:** Empty input, enabled button
- **Checking:** Button shows `Проверка...`, input disabled
- **Error:** Red error text below input, button re-enabled
- **Success:** TokenGate hides, admin layout reveals

### 3.2 AdminNav

**File:** `src/lib/components/admin/AdminNav.svelte`

| Element       | Description                                                                         |
| ------------- | ----------------------------------------------------------------------------------- |
| Tab buttons   | 4 pill buttons: `Дашборд`, `Выплаты`, `Якоря`, `Бот`. Active tab is primary (dark). |
| Logout button | `Выйти` (secondary, right-aligned). Calls `clearToken()`.                           |

### 3.3 Admin Dashboard (`/admin`)

**File:** `src/routes/admin/+page.svelte`

**Data sources:** `GET /api/health`, `GET /api/totals`, `GET /api/verify`, `GET /api/ledger-events?limit=5`

**Layout:** Single column, vertical stack.

#### Sections (in order):

| Section                                | Elements                                                                                                                                                                                               |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| H1                                     | `Дашборд`                                                                                                                                                                                              |
| **System health**                      | H2 `Состояние системы`. Card with status Badge (OK/DEGRADED). DL grid of 5 checks: `База данных`, `Якорь не устарел`, `Баланс SOL якоря`, `Ingest активен`, `Helius без задержек` — each shows ✓ or ✗. |
| **Current HEAD**                       | H2 `Текущий HEAD`. Card with full HashDisplay + sequence number.                                                                                                                                       |
| **Latest anchor**                      | H2 `Последний якорь`. Card with anchored HEAD hash, publication date, SolscanLink. Or `Якорь ещё не опубликован.`                                                                                      |
| **Anchor stale warning** (conditional) | Amber card: `Якорь устарел (более 25 часов)`                                                                                                                                                           |
| **Low SOL warning** (conditional)      | Red-bordered card: `Низкий баланс SOL` + `Пополните кошелёк якоря.`                                                                                                                                    |
| **Totals**                             | H2 `Итоги`. DL grid: `Всего получено`, `Всего выплачено`, `Текущий баланс` (all in USDC), `Донатов` (count), `Выплат` (count).                                                                         |
| **Quick links**                        | H2 `Действия`. 3 card-links: `Записать выплату →`, `Управление якорем →`, `Доставка сертификатов →`                                                                                                    |
| **Recent events**                      | H2 `Последние события`. List of 5 event rows (Badge + summary + date), each linking to `/ledger/{hash}`. Or `Событий пока нет.`                                                                        |

**States per section:**

- **Loading:** `Загрузка...`
- **Error:** Red-bordered card with message + `Повторить` button
- **Loaded:** Data display
- **Empty:** Appropriate empty-state text

---

### 3.4 Disbursement Recording (`/admin/disbursements`)

**File:** `src/routes/admin/disbursements/+page.svelte`

**Data source:** `POST /api/disbursements` (operator endpoint)

**Layout:** Single column, max-width 40rem.

#### Form (pre-submit):

| Field                          | Input type                                        | Validation                                                                                  |
| ------------------------------ | ------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **Сумма (USDC)**               | text input, placeholder `50.00`                   | Must be valid positive number. Hint: `Например: 50.00 = 50 USDC`                            |
| **Количество сертификатов**    | number input                                      | 1–1000. Hint: `1–1000`                                                                      |
| **Сервис**                     | select dropdown                                   | Options: `Alter`, `Yasno`, `Zigmund`, `Другой`                                              |
| **Примечание** (conditional)   | text input, placeholder `Название сервиса`        | Appears only when `Другой` selected. 1–64 chars. Cleared when switching away from `Другой`. |
| **Номер чека**                 | text input, placeholder `ALTER-2026-06-14-A1B2C3` | 4–64 chars, regex `/^[A-Za-z0-9-]{4,64}$/`. Hint: `4–64 символов (буквы, цифры, дефис)`     |
| **Публичная ссылка**           | radio group                                       | `Сгенерировать (по умолчанию)` or `Не публиковать`                                          |
| **Дата и время покупки (UTC)** | datetime-local input                              | Optional. Must not be in future. Hint: `Оставьте пустым для текущего времени`               |

**Form footer:**

- Warning text: `Ошибки исправляются через отдельное корректирующее событие. Не отправляйте форму повторно для исправления ошибки. Если доставка кода не удалась, не записывайте выплату заново — повторите отправку кода через страницу бота.`
- Submit button: `Записать выплату` (primary). Shows `Отправка...` while submitting.

**Error state:** `form-error` text below fields.

#### Success result card (post-submit):

Green-background card with:

- H2 `Выплата записана`
- DL grid: `Номер` (#seq), `Хеш события` (full HashDisplay), `HEAD` (HashDisplay), `Публичная ссылка` (code, if generated)
- Link: `Открыть в реестре →` (/ledger/{hash})
- Link: `Следующий шаг: отправить код через бота →` (/admin/bot)
- Button: `Новая выплата` (resets form)

---

### 3.5 Anchor Management (`/admin/anchors`)

**File:** `src/routes/admin/anchors/+page.svelte`

**Data sources:** `GET /api/totals`, `GET /api/verify` (public), `POST /api/anchor/manual` (operator)

**Layout:** Single column, max-width 40rem, vertical stack.

#### Sections (in order):

| Section                                | Elements                                                                                                         |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| H1                                     | `Управление якорем`                                                                                              |
| **Current status**                     | H2 `Текущий статус`. Card with anchored HEAD hash, publication date, SolscanLink. Or `Якорь ещё не опубликован.` |
| **Anchor stale warning** (conditional) | Amber card: `Якорь устарел`                                                                                      |
| **Low SOL warning** (conditional)      | Red-bordered card: `Низкий баланс SOL на кошельке якоря`                                                         |
| **Current HEAD**                       | Card with full HashDisplay + sequence number                                                                     |
| **Pre-anchor explanation**             | Yellow-background card: `Важно: Якорь фиксирует HEAD реестра, существовавший ДО публикации якоря.`               |
| **Trigger section**                    | H2 `Публикация якоря`                                                                                            |

**Trigger flow (state machine):**

| State                       | UI                                                                                                                                                                                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Idle**                    | `Опубликовать якорь` button (primary). Disabled while totals loading.                                                                                                                                                                                  |
| **Confirmed (first click)** | Amber card: explanation text + `Продолжить?` + two buttons: `Да, опубликовать` (primary) and `Отмена` (secondary)                                                                                                                                      |
| **Running**                 | Card: `Публикация якоря выполняется...`                                                                                                                                                                                                                |
| **Success**                 | Green card: H3 `Якорь опубликован`. DL grid: `Статус`, `ID запуска` (#id), `Закреплённый HEAD` (full HashDisplay), `Memo` (code), `Транзакция` (SolscanLink), `Длительность` (ms). Link: `Проверить на странице верификации →`. Button: `ОК` (resets). |
| **Already published**       | Blue card: H3 `HEAD уже закреплён ранее`. Explanation + current anchor details. Button: `ОК` (resets).                                                                                                                                                 |
| **Error**                   | Red-bordered card: H3 `Ошибка` + message. Button: `Закрыть` (resets).                                                                                                                                                                                  |

---

### 3.6 Bot Certificate Delivery (`/admin/bot`)

**File:** `src/routes/admin/bot/+page.svelte`

**Data sources:** `GET /tg/internal/pending-requests` (operator), `POST /tg/internal/send-code` (operator)

**Layout:** Single column, max-width 40rem, vertical stack.

#### Sections (in order):

| Section              | Elements                                                  |
| -------------------- | --------------------------------------------------------- |
| H1                   | `Доставка сертификатов`                                   |
| **Pending requests** | H2 `Запросы на доставку`. List of clickable request rows. |

**Request row content:**

- Badge: status label (`Ожидает`, `Выплата записана`, `Код доставлен`, `Отменён`). Variant: default for pending, green otherwise.
- Handle: `{internal_handle}` (if present)
- Date: formatted `created_at_utc`, right-aligned
- Selected state: blue border + blue background

**Empty state:** `Нет активных запросов.`

**Selected request detail** (appears when a request is clicked):

| Element     | Description                                                                                                               |
| ----------- | ------------------------------------------------------------------------------------------------------------------------- |
| H2          | `Выбранный запрос`                                                                                                        |
| Detail card | DL grid: `opaque_id` (code), `conversation_id` (code), `Получатель` (handle, if present), `Статус`, `Создан`, `Обновлён`  |
| Hint text   | `Сначала запишите выплату через страницу выплат, затем вернитесь сюда для отправки кода.` (links to /admin/disbursements) |

**Send code form** (appears below selected request):

| Element       | Description                                                                                        |
| ------------- | -------------------------------------------------------------------------------------------------- |
| H2            | `Отправка кода`                                                                                    |
| Code input    | text input, placeholder `Введите код сертификата`, autocomplete off. Cleared on component destroy. |
| Hint          | `Код будет очищен после отправки`                                                                  |
| Error         | `form-error` text                                                                                  |
| Submit button | `Отправить код` (primary). Shows `Отправка...` while sending. Disabled when empty or sending.      |

**Success state:**
Green card: `Код доставлен: {date}` + `Готово` button (clears selection and result).

---

## 4. Shared Components

### 4.1 Timeline & Event Display Components

#### Timeline (`Timeline.svelte`)

- Wraps multiple `TimelineEvent` rows + a final HEAD row
- Props: `events[]`, `headInfo?`, `totals?`
- Rail labels row: `вход` / `карты` / `доказательство` / `реестр`
- HEAD row: date=`сейчас`, rail class `head`, node=`H`, card shows balance + HEAD seq + latest hash

#### TimelineEvent (`TimelineEvent.svelte`)

- Single event row: date column + `TimelineRail` + `TimelineCard`
- Props: `event`

#### TimelineRail (`TimelineRail.svelte`)

- 4 vertical lanes (in/out/proof/main) + merge line + node
- Node symbols: `+` (donation), `−` (disbursement), `#` (anchor), `◇` (correction)
- Rail class colors lanes: `in` (green), `out` (amber), `anchor` (blue), `system` (purple)

#### TimelineCard (`TimelineCard.svelte`)

- Card per event type with parsed payload:
  - **Donation:** title `Анонимное пожертвование`, amount `+{n} USDC` (green), meta: tx link + hash
  - **Disbursement:** title `Куплены подарочные карты {service} ×{count}`, amount `−{n} USDC` (amber), meta: receipt_ref + beneficiary ref, chips: `без имён получателей`, `чек опубликован`
  - **Anchor:** title `Хэш реестра закреплён в Solana`, amount `ok` (blue), meta: anchor tx link + sha256, extra: verification note
  - **Correction:** title `Коррекция #{seq}`, amount `—`, meta: reason + replacement fields
  - **Fallback:** title `Событие #{seq}`, amount `—`, meta: hash

#### EventCard (`EventCard.svelte`)

- Compact card variant (used in admin dashboard recent events)
- Badge (type) + sequence number + amount + date + truncated hash

### 4.2 Display Components

#### HashDisplay (`HashDisplay.svelte`)

- Props: `hash`, `label?`, `full?` (default false = truncated)
- Renders: `{label}:` (muted) + `<code>` with full hash as title attribute
- Truncation: first 8 + last 6 chars with `...`

#### SolscanLink (`SolscanLink.svelte`)

- Props: `txSignature`, `cluster?` (default mainnet-beta), `label?` (default `tx`)
- Renders: `{label}: {truncated_sig} ↗` — external link to Solscan

#### CopyButton (`CopyButton.svelte`)

- Props: `text`, `label?` (default `Скопировать`)
- On click: copies to clipboard, shows `✓ Скопировано` for 2 seconds
- Silently fails if clipboard API unavailable

#### QrCode (`QrCode.svelte`)

- Props: `text`, `size?` (default 160)
- Dynamic import of `qrcode` library, generates SVG data URI
- White background, bordered, rounded. Shows `QR` placeholder while loading.

### 4.3 Interactive Components

#### FilterTabs (`FilterTabs.svelte`)

- Props: `tabs[]` ({key, label}), `active`, `onchange?`
- Chip-style buttons in flex row. Active tab: inverted colors (dark bg, light text).

#### Pagination (`Pagination.svelte`)

- Props: `hasMore`, `loading?`, `onload?`
- Shows `Загрузить ещё` button (or `Загрузка...` while loading). Hidden when `!hasMore`.

### 4.4 UI Primitives (bits-ui based)

#### Button (`ui/button/button.svelte`)

- Variants: `primary` (dark bg), `secondary` (translucent white bg)
- Sizes: `sm` (8px 12px padding), `md` (12px 16px), `lg` (14px 20px)
- Can render as `<a>` (if `href` provided) or `<button>`
- Props: `variant`, `size`, `href?`, `type?`, `disabled?`, `onclick?`, `class?`, `children` (snippet)

#### Badge (`ui/badge/badge.svelte`)

- Variants: `default` (muted), `green`, `amber`, `blue`, `purple`
- Renders as `<span class="chip">` with variant color

#### Card (`ui/card/card.svelte`)

- Renders as `<div class="standalone-card">`
- Props: `class?`, `children` (snippet)

#### Input (`ui/input/input.svelte`)

- Props: `type?`, `placeholder?`, `value?`, `disabled?`, `autocomplete?`, `oninput?`, `class?`
- Renders `<input class="form-input">`

#### Select (`ui/select/select.svelte`)

- Props: `value?`, `disabled?`, `onchange?`, `class?`, `children` (snippet for `<option>`s)
- Renders `<select class="form-select">`

#### Code (`ui/code/code.svelte`)

- Props: `class?`, `children` (snippet)
- Renders `<code>` with global code styling

---

## 5. Design System (from `app.css`)

### 5.1 Color Tokens

| Token           | Value                    | Usage                         |
| --------------- | ------------------------ | ----------------------------- |
| `--border`      | `rgba(91,65,51,0.16)`    | Card/input borders            |
| `--border-soft` | `rgba(91,65,51,0.12)`    | Subtle separators             |
| `--muted`       | `#795f53`                | Secondary text, hints         |
| `--title`       | `#35251d`                | Primary text, dark buttons    |
| `--green`       | `#4f9d69`                | Donations, success, OK status |
| `--amber`       | `#d98151`                | Disbursements, warnings       |
| `--blue`        | `#6f82d6`                | Anchors, info                 |
| `--purple`      | `#b982c7`                | Corrections                   |
| `--link`        | `#7c5fcb`                | Hyperlinks                    |
| `--code`        | `#5e493f`                | Inline code text              |
| `--code-bg`     | `rgba(255,255,255,0.72)` | Inline code background        |
| `--card-bg`     | `#fffaf2`                | Card backgrounds              |
| `--page-bg`     | `#fff7ec`                | Page background               |
| `--rail-muted`  | `rgba(91,65,51,0.13)`    | Inactive rail lanes           |
| `--rail-main`   | `rgba(91,65,51,0.28)`    | Main rail lane                |

### 5.2 Typography

- Font: Inter, system-ui sans-serif stack
- H1: `clamp(44px, 7vw, 82px)`, line-height 0.92, letter-spacing -0.085em
- H2: 1.5rem, letter-spacing -0.03em
- H3: 1.1rem, letter-spacing -0.02em
- Lead: 18px, color #73584d, line-height 1.55
- Body text in static pages: color #73584d, line-height 1.55
- Code: 11px monospace

### 5.3 Spacing & Layout

- Page wrapper: max-width 1180px, padding 30px (20px below 760px)
- Hero grid: `0.74fr 1.26fr`, gap 36px
- Cards: border-radius 20px (feed), 30px (feed container)
- Buttons: border-radius 999px (fully rounded pills)
- Chips: border-radius 999px
- Code blocks: border-radius 12px

### 5.4 Responsive Breakpoints

| Breakpoint | Changes                                                                                                                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ≤980px     | Hero stacks to single column. Nav links hidden.                                                                                                                                                  |
| ≤760px     | Padding reduced to 20px. Header stacks vertically. Metrics stack to 1 column. Rail labels hidden. Event rows collapse to 2-column (28px rail + card). Side lanes hidden, only main lane visible. |

### 5.5 Animations & Motion

- Skeleton loading: pulse animation (1.5s ease-in-out)
- Transitions: 0.15s on buttons, inputs, links
- `prefers-reduced-motion`: all animations/transitions forced to 0.01ms

---

## 6. API Endpoints Consumed by Frontend

### 6.1 Public (no auth) — via `$lib/api/client.ts`

| Function                    | Endpoint                 | Used by                                                 |
| --------------------------- | ------------------------ | ------------------------------------------------------- |
| `getTotals()`               | `GET /api/totals`        | Landing, Admin dashboard, Admin anchors                 |
| `getDonations(params?)`     | `GET /api/donations`     | (defined but not used in current UI)                    |
| `getDisbursements(params?)` | `GET /api/disbursements` | (defined but not used in current UI)                    |
| `getLedgerEvents(params?)`  | `GET /api/ledger-events` | Landing, Ledger, Event detail, Admin dashboard          |
| `getVerify()`               | `GET /api/verify`        | Landing, Ledger, Verify, Admin dashboard, Admin anchors |
| `getHealth()`               | `GET /api/health`        | Admin dashboard                                         |

### 6.2 Operator (auth required) — via `$lib/api/operator.ts`

| Function                 | Endpoint                        | Method | Used by                          |
| ------------------------ | ------------------------------- | ------ | -------------------------------- |
| `postDisbursement(body)` | `/api/disbursements`            | POST   | Admin disbursements              |
| `postAnchorManual()`     | `/api/anchor/manual`            | POST   | Admin anchors                    |
| `getPendingRequests()`   | `/tg/internal/pending-requests` | GET    | Admin bot, TokenGate (auth test) |
| `postSendCode(body)`     | `/tg/internal/send-code`        | POST   | Admin bot                        |

### 6.3 Error Handling

All API calls return `Result<T, ApiError>` discriminated union. Error codes:

- `NETWORK_ERROR` — fetch failed (status 0)
- `VALIDATION_ERROR` — response failed Valibot schema check
- `PARSE_ERROR` — response not valid JSON
- `UNAUTHORIZED` — 401 (clears token)
- `FORBIDDEN` — 403 (does not clear token)
- `NO_TOKEN` — operator endpoint called without token set

---

## 7. State Management

### 7.1 Token State (`$lib/state/token.svelte.ts`)

- Memory-only `$state<string | null>`
- 30-minute idle timeout (reset on click/keypress/scroll/mousemove)
- Cleared on: reload, tab close, explicit logout, 401 response, idle timeout
- Never persisted to any storage

### 7.2 Reactive Fetch (`$lib/state/api.svelte.ts`)

- `FetchState<T>` class with reactive `data`, `error`, `loading` runes
- `createFetch(fetcher)` — auto-fetches on creation
- `createLazyFetch(fetcher)` — manual `refetch()` only
- Used by all pages for API data

---

## 8. Complete Button Inventory

### 8.1 Navigation Buttons (links styled as buttons)

| Page                 | Button                                | Target               | Variant          |
| -------------------- | ------------------------------------- | -------------------- | ---------------- |
| Landing              | `Помочь оплатить сессии`              | /donate              | primary          |
| Landing              | `Посмотреть историю`                  | /ledger              | secondary        |
| Error                | `На главную`                          | /                    | primary          |
| Error                | `Сообщить о проблеме`                 | /contact             | secondary        |
| About                | `Проверить реестр →`                  | /verify              | text link        |
| About                | `Частые вопросы →`                    | /faq                 | text link        |
| Admin dashboard      | `Записать выплату →`                  | /admin/disbursements | card-link        |
| Admin dashboard      | `Управление якорем →`                 | /admin/anchors       | card-link        |
| Admin dashboard      | `Доставка сертификатов →`             | /admin/bot           | card-link        |
| Disbursement success | `Открыть в реестре →`                 | /ledger/{hash}       | text link        |
| Disbursement success | `отправить код через бота →`          | /admin/bot           | text link        |
| Anchor success       | `Проверить на странице верификации →` | /verify              | text link        |
| Bot page             | `страницу выплат`                     | /admin/disbursements | inline text link |

### 8.2 Action Buttons

| Page                           | Button                           | Action                                         | Variant            |
| ------------------------------ | -------------------------------- | ---------------------------------------------- | ------------------ |
| Landing (error)                | `Повторить`                      | `ledgerFeed.refetch()`                         | btn-sm             |
| Ledger (error)                 | `Повторить`                      | `ledger.refetch()`                             | btn-sm             |
| Ledger                         | `Экспорт JSON (API) ↗`           | external link to API                           | btn-sm             |
| Ledger                         | `Загрузить ещё`                  | `loadMore()`                                   | btn (secondary)    |
| Event detail (error)           | `Повторить`                      | `ledger.refetch()`                             | btn-sm             |
| Verify (error)                 | `Попробовать снова`              | `verify.refetch()`                             | btn (secondary)    |
| Verify                         | `Скачать полный реестр (JSON) ↗` | external link to API                           | btn (secondary)    |
| TokenGate                      | `Войти`                          | submit token                                   | primary            |
| AdminNav                       | `Выйти`                          | `clearToken()`                                 | btn-sm (secondary) |
| Admin dashboard (error)        | `Повторить`                      | `health.refetch()` / `totals.refetch()` / etc. | btn-sm             |
| Disbursement form              | `Записать выплату`               | submit form                                    | primary            |
| Disbursement success           | `Новая выплата`                  | `resetForm()`                                  | btn (secondary)    |
| Anchor (idle)                  | `Опубликовать якорь`             | first click → confirm                          | primary            |
| Anchor (confirm)               | `Да, опубликовать`               | `triggerAnchor()`                              | primary            |
| Anchor (confirm)               | `Отмена`                         | `confirmed = false`                            | secondary          |
| Anchor (success/already/error) | `ОК` / `Закрыть`                 | `reset()`                                      | btn (secondary)    |
| Bot (send)                     | `Отправить код`                  | `handleSend()`                                 | primary            |
| Bot (success)                  | `Готово`                         | clear selection + result                       | btn (secondary)    |

### 8.3 Utility Buttons (in components)

| Component  | Button                          | Action            |
| ---------- | ------------------------------- | ----------------- |
| CopyButton | `Скопировать` / `✓ Скопировано` | clipboard write   |
| FilterTabs | 5 chip buttons                  | set active filter |
| Pagination | `Загрузить ещё` / `Загрузка...` | load next page    |

---

## 9. Form Fields Inventory

### 9.1 TokenGate

| Field | Type     | Placeholder               | Validation |
| ----- | -------- | ------------------------- | ---------- |
| token | password | `Введите токен оператора` | non-empty  |

### 9.2 Disbursement Form

| Field                | Type               | Placeholder/Default       | Validation                           |
| -------------------- | ------------------ | ------------------------- | ------------------------------------ |
| amount               | text               | `50.00`                   | positive number                      |
| giftCardCount        | number             | 1                         | 1–1000                               |
| service              | select             | Alter                     | one of: Alter, Yasno, Zigmund, Other |
| serviceNote          | text (conditional) | `Название сервиса`        | 1–64 chars (only when service=Other) |
| receiptRef           | text               | `ALTER-2026-06-14-A1B2C3` | 4–64 chars, alphanumeric + hyphen    |
| publicBeneficiaryRef | radio              | generate                  | generate / none                      |
| purchasedAtUtc       | datetime-local     | (empty = now)             | not in future                        |

### 9.3 Bot Send Code

| Field | Type | Placeholder               | Validation |
| ----- | ---- | ------------------------- | ---------- |
| code  | text | `Введите код сертификата` | non-empty  |

---

## 10. Data Display Patterns

### 10.1 Hash Display

- Full: 64-char hex string in `<code>`
- Truncated: `{first8}...{last6}` (14 chars total)
- Always has full hash as `title` attribute for tooltip/copy

### 10.2 USDC Amount Formatting

- Input: minor units string (e.g. `"50000000"` = 50 USDC)
- Display: `{n} USDC` with 2 decimal places (e.g. `50.00 USDC`)
- Compact variant (`formatUsdcAmount`): drops `.00` when whole number

### 10.3 Date Formatting

- Full date: `DD.MM.YYYY, HH:MM UTC` (via `formatDate`)
- Timeline date: `{day} {month_abbr}` + `{HH}:{MM}` (via `formatTimelineDate`)
- Anchor date: `DD.MM.YYYY` (via `formatAnchorDate`)

### 10.4 Status Badges

- `OK` → green
- `DEGRADED` → amber
- `закреплено` / `ожидается` → text in metric card
- Health checks: `✓` or `✗`

### 10.5 Empty States

- "Реестр пуст" / "Пока нет событий" / "Нет активных запросов" / "Якорь ещё не опубликован"
- Each includes a muted explanation of when data will appear

---

## 11. Page-Level States Summary

| Page                | Loading                                    | Error                                                   | Empty                         | Loaded                            |
| ------------------- | ------------------------------------------ | ------------------------------------------------------- | ----------------------------- | --------------------------------- |
| Landing             | Metrics show `—`, feed shows `Загрузка...` | Feed shows error + retry button                         | `Пока нет событий.`           | Full hero + timeline              |
| Donate              | N/A (static)                               | N/A                                                     | N/A                           | Always loaded                     |
| Ledger              | `Загрузка...`                              | Error card + retry                                      | `Пока нет событий в реестре.` | Event list + pagination           |
| Event detail        | `Загрузка...`                              | Error card + retry                                      | `Событие не найдено`          | Full detail view                  |
| Verify              | 3 skeleton cards (pulse anim)              | Red error card + localized message + request ID + retry | Empty states per section      | All 9 sections                    |
| About               | N/A (static)                               | N/A                                                     | N/A                           | Always loaded                     |
| FAQ                 | N/A (static)                               | N/A                                                     | N/A                           | Always loaded                     |
| Contact             | N/A (static)                               | N/A                                                     | N/A                           | Always loaded                     |
| Admin dashboard     | `Загрузка...` per section                  | Red error card + retry per section                      | Empty states per section      | All sections                      |
| Admin disbursements | N/A (form always shown)                    | `form-error` text                                       | N/A                           | Form or success card              |
| Admin anchors       | `Загрузка...` for status                   | Red error card                                          | `Якорь ещё не опубликован.`   | Status + trigger                  |
| Admin bot           | `Загрузка...` for requests                 | Error card + retry                                      | `Нет активных запросов.`      | Request list + detail + send form |
| TokenGate           | `Проверка...` on button                    | `form-error` text                                       | N/A                           | Gates access                      |
| Error page          | N/A                                        | N/A                                                     | N/A                           | Always shows error info           |
