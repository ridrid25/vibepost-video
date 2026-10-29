# medved-flow10 — точечная правка режиссёра (бит 0.80–1.40)

Замечание: «Лиса встречает медведя на улице возле двери и отдаёт ему ключи.»
Остальные биты, реплики, тайминги — без изменений (см. прошлый вариант).

## Постановка

| Время | Действие | Место | ФОКУС | Звук |
|---|---|---|---|---|
| 0.80–1.40 | клешня роняет его брюхом у его круглой двери; лиса уже снаружи, вынимает её ключ из его зубов и вкладывает ему в лапу; монеты банка за ней | улица, у его двери, банк рядом | ключ: зубы → её лапа → его лапа | 1.0 coin clink (оставить) |
| 1.40–2.45 | он поворачивает ключ, дверь распахивается; за ним она запрыгивает обратно в окошко | дверь норы, окошко на фоне | дверь (лиса сзади, мелко) | без изменений |

Ключ один: тот же, что в зубах на 0.00. Владелец — лиса; на 0.80–3.30 он в его лапе/замке, на 3.30 её клешня забирает.

## Правки (Старое / Новое)

1. timeline[1].a (0.80–1.40)
   - Старое (149): `her claw opens, he drops belly-down under her window; her key clinks from his teeth onto her counter; her paw pushes it between her bars into his paw`
   - Новое (120): `her claw drops him belly-down at his door; outside there she pulls her key from his teeth into his paw, her coins behind`

2. timeline[2].a (1.40–2.45) — возврат лисы одним действием
   - Старое (91): `he turns her key in his lock, his round door flies open: his pillow, stump, jar; mouth free`
   - Новое (120): `he turns her key in his lock, his round door flies open: his pillow, stump, jar; she hops back in her window; mouth free`

3. second_characters
   - Старое (98): `ONE ginger fox in a green visor behind her barred window; only her paw or claw reaches out; silent`
   - Новое (98): `ONE ginger fox in a green visor, emerald vest; at his door till 1.40, then behind her bars; silent`

4. negative_prompt
   - Старое: `..., second jar, fox outside her bank`
   - Новое: `..., second jar, fox outside after 1.40`  (+2)

## Подсчёт знаков

Было 4070. Итог после правок 1–4: 4070 (проверено сборкой JSON). Лимит 4080 — проходит.
Слов crane, safe, rope, hang, string, cord нет.
