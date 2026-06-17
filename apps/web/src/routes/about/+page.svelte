<svelte:head>
  <title>О проекте — Open Care</title>
  <meta
    name="description"
    content="Что такое Open Care, как работает ручной цикл выплат, и почему получатели остаются приватными."
  />
</svelte:head>

<section class="section">
  <h1>О проекте</h1>
  <p>
    Open Care — это проект прозрачной благотворительности, где каждый перевод USDC на Solana записан
    в открытый реестр с криптографической проверкой.
  </p>
</section>

<section class="section">
  <h2>Как это работает</h2>
  <ol class="steps-list">
    <li>
      <strong>Пожертвование:</strong> Донор отправляет USDC на открытый кошелёк проекта через Solana.
    </li>
    <li>
      <strong>Запись в реестр:</strong> Бэкенд фиксирует финализированный перевод и создаёт запись
      <code>donation_confirmed</code> с хешем.
    </li>
    <li>
      <strong>Выплата:</strong> Оператор покупает подарочный сертификат и записывает выплату в
      реестр с <code>public_beneficiary_ref</code> — публичным идентификатором без личных данных.
    </li>
    <li>
      <strong>Доставка:</strong> Бот доставляет сертификат получателю приватно через Telegram.
    </li>
    <li>
      <strong>Якорение:</strong> Периодически текущий HEAD реестра записывается в блокчейн Solana через
      Memo-транзакцию.
    </li>
  </ol>
</section>

<section class="section">
  <h2>Почему ручной цикл?</h2>
  <p>
    MVP использует ручное приобретение подарочных сертификатов оператором. Это осозненное
    ограничение:
  </p>
  <ul class="content-list">
    <li>Автоматическая покупка сертификатов повышает сложность и риски.</li>
    <li>Ручной цикл позволяет оператору проверять запросы и контекст.</li>
    <li>Все выплаты записаны в реестре — публично, без личных данных получателя.</li>
  </ul>
</section>

<section class="section">
  <h2>Разделение кошельков</h2>
  <div class="card">
    <div class="wallet-row">
      <strong>Treasury кошелёк</strong> — принимает пожертвования USDC.
    </div>
    <div class="wallet-row">
      <strong>Anchor кошелёк</strong> — оплачивает Memo-транзакции для якорения реестра. Отдельный от
      treasury.
    </div>
  </div>
  <p class="muted">
    Приватный ключ treasury никогда не покидает оператора и не хранится в Workers, CI, репозитории
    или логах.
  </p>
</section>

<section class="section">
  <h2>Почему получатели остаются приватными</h2>
  <p>
    Имена, контакты, Telegram ID, внутренние идентификаторы и коды подарочных сертификатов <strong
      >никогда не публикуются</strong
    >
    в реестре. Публичны только суммы, даты, хеши и сгенерированные сервером
    <code>public_beneficiary_ref</code>.
  </p>
  <p>Это позволяет проверять финансовую прозрачность без раскрытия личности получателей.</p>
</section>

<section class="section warning-box">
  <h3>Честные ограничения</h3>
  <p>
    Хеши доказывают целостность истории записей. Они <strong>не доказывают</strong> подлинность чеков,
    получение сертификата или качество услуги. Переводы видны в блокчейне Solana.
  </p>
</section>

<style>
  .steps-list {
    padding-left: 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .steps-list li {
    margin-bottom: 0.25rem;
  }

  .content-list {
    padding-left: 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .wallet-row {
    padding: 0.5rem 0;
    border-bottom: 1px solid var(--color-border);
  }

  .wallet-row:last-child {
    border-bottom: none;
  }
</style>
