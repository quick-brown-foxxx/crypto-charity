<svelte:head>
  <title>Контакт — Open Care</title>
  <meta
    name="description"
    content="Сообщите о несовпадении хеша, отсутствующем пожертвовании, проблеме приватности или задайте вопрос."
  />
</svelte:head>

<section class="section">
  <h1>Контакт</h1>
  <p>Сообщите о проблеме или задайте вопрос. Мы не запрашиваем приватные данные.</p>
</section>

<section class="section">
  <h2>Когда обращаться</h2>
  <ul class="contact-list">
    <li>
      <strong>Несовпадение хеша:</strong> Если ваш локальный расчёт не совпадает с HEAD реестра.
    </li>
    <li>
      <strong>Отсутствующее пожертвование:</strong> Если перевод не появился в реестре после ожидаемого
      окна.
    </li>
    <li>
      <strong>Проблема приватности:</strong> Если вы обнаружили публикацию данных, которые не должны быть
      публичными.
    </li>
    <li>
      <strong>Подозрение на утечку секретов:</strong> Если вы считаете, что операторный токен, ключи или
      другие секреты были скомпрометированы.
    </li>
    <li><strong>Общий вопрос:</strong> Любой вопрос о работе проекта.</li>
  </ul>
</section>

<section class="section">
  <h2>Как связаться</h2>
  <div class="card">
    <p>Связь через Telegram:</p>
    <p>
      <a href="https://t.me/your-contact-channel" rel="noopener noreferrer" target="_blank"
        >@your-contact-channel</a
      >
    </p>
    <p class="muted">Ссылка будет обновлена при запуске.</p>
  </div>
</section>

<section class="section warning-box">
  <h3>⚠️ Что НЕ отправлять</h3>
  <ul class="do-not-list">
    <li>Приватные ключи или seed-фразы</li>
    <li>Telegram ID или номера телефонов</li>
    <li>Реальные имена</li>
    <li>Коды подарочных сертификатов</li>
    <li>Пароли или операторные токены</li>
  </ul>
</section>

<section class="section">
  <h2>Что полезно сообщить</h2>
  <ul class="contact-list">
    <li>
      <strong>Сигнатура транзакции</strong> — tx hash из вашего кошелька (публичная информация в Solana).
    </li>
    <li><strong>URL страницы</strong> — где вы увидели проблему.</li>
    <li>
      <strong>Примерное время</strong> — когда произошла операция или когда вы заметили проблему.
    </li>
    <li><strong>Описание</strong> — что вы ожидали увидеть и что увидели.</li>
  </ul>
</section>

<style>
  .contact-list {
    list-style: none;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .contact-list li {
    padding-left: 1.25rem;
    position: relative;
  }

  .contact-list li::before {
    content: '→';
    position: absolute;
    left: 0;
    color: var(--color-primary);
  }

  .do-not-list {
    list-style: none;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .do-not-list li {
    padding-left: 1.25rem;
    position: relative;
  }

  .do-not-list li::before {
    content: '✕';
    position: absolute;
    left: 0;
    color: var(--color-danger);
    font-weight: bold;
  }
</style>
