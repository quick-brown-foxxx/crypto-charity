<svelte:head>
  <title>Контакты — Open Care</title>
</svelte:head>

<section class="static-page">
  <h1>Контакты</h1>

  <h2>Сообщить о проблеме</h2>
  <p>
    Если вы заметили несоответствие в реестре, пропавшее пожертвование, проблему с приватностью или
    у вас есть вопрос — пожалуйста, свяжитесь с нами.
  </p>

  <h2>Что нужно указать</h2>
  <ul>
    <li><strong>Signature транзакции</strong> — если проблема связана с пожертвованием</li>
    <li><strong>Хеш события</strong> — если проблема в реестре</li>
    <li><strong>URL страницы</strong> — на какой странице вы заметили проблему</li>
    <li><strong>Приблизительное время</strong> — когда произошла проблема</li>
    <li><strong>Описание</strong> — что именно не так</li>
  </ul>

  <h2>Что НЕ нужно присылать</h2>
  <ul>
    <li>Telegram ID, имена, контакты</li>
    <li>Коды сертификатов</li>
    <li>Seed-фразы или приватные ключи</li>
    <li>Пароли или токены</li>
  </ul>

  <h2>Как связаться</h2>
  <p>Создайте issue в репозитории проекта на GitHub:</p>
  <p>
    <a
      href="https://github.com/quick-brown-foxxx/open-care/issues/new"
      target="_blank"
      rel="noopener noreferrer"
    >
      Создать issue на GitHub ↗
    </a>
  </p>
  <p>
    Пожалуйста, укажите в issue всю необходимую информацию из списка выше. Не публикуйте в открытом
    issue приватные ключи, seed-фразы, коды сертификатов или личные данные.
  </p>
</section>

<style>
  .static-page {
    max-width: 48rem;
  }
  .static-page h1 {
    margin-bottom: 1.5rem;
  }
  .static-page h2 {
    margin-top: 2rem;
    margin-bottom: 0.75rem;
    font-size: 1.25rem;
  }
  .static-page p {
    margin-bottom: 0.75rem;
  }
  .static-page ul {
    margin-bottom: 1rem;
    padding-left: 1.5rem;
  }
  .static-page li {
    margin-bottom: 0.5rem;
  }
</style>
