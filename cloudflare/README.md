# Монитор на Cloudflare Free

Это основной вариант для бесплатного запуска. Старый Python-сервис в корне — отдельный прототип; одновременно запускать его не нужно.

## Что готово

- Cron DEX: каждые 5 минут; CMC top 300: каждые 15 минут (02,17,32,47, UTC).
- DEX читает только `../watchlist.json`, максимум 10 адресов. Это не поиск всех новых токенов. Неподдерживаемая сеть/отсутствующий пул фиксируются в логах.
- Выбор пула с наибольшей ликвидностью от $10 000, точная проверка сети и базового токена. Это не аудит скама.
- Изменение цены от 10% в любую сторону относительно предыдущего снимка (давностью 4–30 минут) создаёт сигнал в D1. Новый пул начинает свою историю. Повторные сигналы ограничены 30 минутами.
- Снимки пакетами JSON хранятся 7 дней, сигналы 30 дней. Частичная ошибка DEX не мешает другим токенам; сравнение пропущенного токена возобновится после двух успешных снимков.
- Каждый алерт до появления результата фиксируется как неизменяемый теневой сигнал `momentum-v1`: рост означает long, падение — short. Конкурирующая модель `contrarian-v1` получает противоположное направление на той же точке входа.
- Для обоих направлений считаются forward-результаты через 15, 60 и 240 минут. По умолчанию из результата вычитается 20 bps полных транзакционных расходов. Значение сохраняется в самом сигнале, поэтому последующая смена конфигурации не переписывает историю.
- Берётся первая доступная котировка на или после горизонта. Если котировки нет ещё 30 минут, результат получает явный статус `missing`; такие случаи видны в scorecard и не исчезают из выборки.
- Telegram отправляет новые shadow-сигналы и результаты 15/60/240 минут через durable outbox. Сбой Telegram не откатывает сигнал: pending-сообщения повторяются на следующем Cron. X, AI-анализ и торговля не подключены.
- Публичного HTTP API нет.

## Запуск из терминала своего компьютера

Нужен аккаунт Cloudflare на Workers Free, Node.js 22+ и новый CMC ключ. Секреты не отправлять в чат или GitHub.

```sh
git clone https://github.com/deontey303/crypto-monitor.git
cd crypto-monitor/cloudflare
npx wrangler@4 login
npx wrangler@4 d1 create crypto-monitor
```

Скопируйте выданный `database_id` в `wrangler.toml` вместо `REPLACE_WITH_D1_DATABASE_ID`. Имя binding должно остаться `DB`.

```sh
node --test worker.test.mjs
npx wrangler@4 d1 execute crypto-monitor --remote --file=schema.sql
npx wrangler@4 deploy --dry-run
npx wrangler@4 deploy
npx wrangler@4 secret put CMC_API_KEY
npx wrangler@4 secret put TELEGRAM_BOT_TOKEN
npx wrangler@4 secret put TELEGRAM_CHAT_ID
npx wrangler@4 tail
```

Команды ввода секретов запрашивают значения интерактивно. Не вставляйте bot token в чат, GitHub или `wrangler.toml`. `TELEGRAM_CHAT_ID` — числовой ID личного чата или канала, в который бот уже добавлен и имеет право писать. До добавления CMC-секрета CMC пропускает сбор с ошибкой `cmc_secret_missing`; DEX продолжает работать. Без Telegram-секретов уведомления остаются в outbox и не отправляются. Распространение Cron может занять до 15 минут.

Проверьте успешные запуски обоих источников, число котировок, ошибки и CPU Time в Cloudflare. На Free лимит CPU — 10 ms на запуск: его соблюдение требуется проверить на реальных ответах API. При превышении уменьшите CMC limit до 100 и/или watchlist; платный тариф автоматически не включать. Увеличение интервала само по себе не уменьшает CPU одного запуска.

Проверка данных:

```sh
npx wrangler@4 d1 execute crypto-monitor --remote --command="SELECT source,ts FROM state"
npx wrangler@4 d1 execute crypto-monitor --remote --command="SELECT * FROM budget"
npx wrangler@4 d1 execute crypto-monitor --remote --command="SELECT source,ts,data FROM signals ORDER BY ts DESC LIMIT 5"
npx wrangler@4 d1 execute crypto-monitor --remote --command="SELECT * FROM shadow_signals ORDER BY created_at DESC LIMIT 5"
npx wrangler@4 d1 execute crypto-monitor --remote --command="SELECT * FROM shadow_outcomes ORDER BY due_at DESC LIMIT 15"
npx wrangler@4 d1 execute crypto-monitor --remote --command="SELECT * FROM shadow_scorecard ORDER BY horizon_minutes"
npx wrangler@4 d1 execute crypto-monitor --remote --command="SELECT kind,status,attempts,created_at,sent_at FROM notification_outbox ORDER BY created_at DESC LIMIT 20"
```

## Контракт теневого эксперимента

Первичная метрика — парная разница средней чистой доходности `momentum-v1` и `contrarian-v1` на горизонте 60 минут (`edge_bps` в `shadow_scorecard`). Горизонты 15 и 240 минут вторичны. До накопления 100 evaluated-сигналов на 60 мин результат считается предварительным; долю `missing` нужно публиковать вместе с доходностью. Это правило следует менять только новой версией модели, не задним числом.

Доходность выражена в базисных пунктах от условного линейного бессрочного фьючерса без плеча. Прототип учитывает заданные полные транзакционные расходы, но пока не моделирует funding, spread, price impact, ликвидации и фактическую исполнимость указанной цены. Поэтому положительный scorecard — основание для следующего paper-trading теста, а не доказательство доступной прибыли.

`shadow_signals` защищена от UPDATE/DELETE SQL-триггерами; завершённые и missing outcomes также неизменяемы. Это защищает от случайного переписывания через приложение, но не является криптографическим доказательством против администратора D1.

Telegram — канал наблюдения, а не команда открыть сделку. Delivery использует at-least-once семантику: устойчивый `notification_id` предотвращает повторное создание сообщения, но редкий дубль возможен, если Telegram принял запрос, а Worker завершился до записи `sent` в D1.

Остановка: удалите оба Cron Trigger в настройках Worker. Для изменения периодичности обновите конфигурацию и соответствие `event.cron` в обработчике.

## Бесплатные лимиты и ограничения

384 запуска в сутки: 288 DEX + 96 CMC. Пакетные записи сокращают расход D1; сохраняются только необходимые поля. Бесплатность зависит от суммарного использования аккаунта и актуальных лимитов провайдеров; облачная проверка ещё не выполнена.

`CMC_MONTHLY_BUDGET=14000` — локальный бюджет кредитов за календарный месяц UTC. Перед запросом атомарно резервируются 5 кредитов (`CMC_CALL_RESERVE`), после ответа учитывается `status.credit_count`. При сетевой ошибке резерв сохраняется. При недостатке бюджета CMC останавливается до следующего месяца. Если один запрос стоит 3 кредита, 31 день потребует 8 928 кредитов. Реальную стоимость и квоту необходимо сверить в кабинете CMC. Счётчик не видит расход других приложений и может не совпадать с расчётным периодом CMC; оставляйте запас. Если провайдер увеличит стоимость выше резерва, последний запрос может превысить локальный бюджет: обновите резерв.

`SHADOW_ROUND_TRIP_COST_BPS=20` — заранее заданные полные расходы на вход и выход. Для нового предположения о расходах задайте новую версию эксперимента; не изменяйте старые строки.

Повторная доставка одного Cron не вызывает повторный запрос. Сбой после захвата запуска приводит к пропуску интервала; повтор будет только в следующем интервале. Это сознательный выбор для ограничения расхода.

Документация: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [Cron](https://developers.cloudflare.com/workers/configuration/cron-triggers/), [CMC pricing](https://coinmarketcap.com/api/pricing/).

## Deployment с телефона через GitHub Actions

Workflow `.github/workflows/deploy-cloudflare.yml` запускается только вручную из ветки `main`. Перед первым запуском:

1. В Cloudflare создайте D1 database с именем `crypto-monitor` и скопируйте её UUID.
2. В GitHub откройте **Settings → Secrets and variables → Actions** и добавьте secrets:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
   - `CMC_API_KEY`
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_CHAT_ID`
3. Там же во вкладке **Variables** добавьте `CLOUDFLARE_D1_DATABASE_ID` со скопированным UUID.
4. Откройте **Actions → Deploy Cloudflare Worker → Run workflow**, оставьте ветку `main`, введите `DEPLOY`.

Workflow сначала проверяет наличие конфигурации и запускает тесты, затем применяет идемпотентную D1 schema, разворачивает Worker вместе с secrets и отправляет в Telegram контрольное сообщение с коротким Git commit. Значения secrets в репозиторий не записываются.
