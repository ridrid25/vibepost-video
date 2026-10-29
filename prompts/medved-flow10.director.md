# medved-flow10 — режиссёр (точечная переделка, 27.10.2026)

Основа — medved-flow9.json. События, тайминги, реплики, камера ("c") — как во flow9.
Меняю: 0.80–1.40 (выдача ключа), 3.30 / 6.60 / 8.30 (добыча в кучу у кассы), крючок
(клешня из окошка), имена предметов во всех битах.

## Место и предметы

- Её касса: окошко с решёткой и створкой (flap) в фасаде банка; за решёткой ЕЁ прилавок
  (her counter) со стопками монет. Куча копится там, за решёткой, видна сквозь прутья.
- Он к прилавку не попадает: лежит/сидит на мху ПОД окошком. Лиса наружу не выходит:
  только её лапа (paw) или клешня (claw) из окошка.
- Замена имён: her safe → her bank; his red door → his round door; his doorway → his burrow;
  her slot → her window. Слов safe, red door, slot, crane, rope, hang, string, cord,
  jointed arm нет ни в одной строке.

## Таблица

| t | реплика | действие | место | ФОКУС | КРУПНО | звук |
|---|---|---|---|---|---|---|
| 0.00–0.80 | — | как flow9 | небо | морда с ключом | да | whoosh |
| 0.80–1.40 | — | плюхается под окошко, ключ звякает из зубов на её монеты, её лапа выдаёт ключ ему в лапу сквозь решётку | мох под окошком кассы | ключ из окошка в его лапу | — | coin clink 1.0 |
| 1.40–2.45 | Купил берлогу | имена | его круглая дверца | ключ в замке | — | — |
| 2.45–3.30 | в ипотеку. | как flow9 | порог норы | зад на пороге | да | thump |
| 3.30–4.00 | — | клешня выдёргивает ключ, роняет на её монеты за решёткой; он кидается следом, растягивается | дверца → окошко | ключ на стопке | — | clack + coins 3.7 |
| 4.00–5.45 | Теперь банк владеет мной, | имена | от норы к банку | он в клешне | — | claw jerk |
| 5.45–5.95 | — | имена | нора | полёт на подушку | — | whoosh |
| 5.95–6.60 | моим сном | как flow9 | нора, подушка | подушка | — | whump |
| 6.60–7.25 | — | клешня срывает подушку, голова о пень; подушка в окошко, на её прилавок к ключу | пень → окошко | подушка на куче | да | knock, clack |
| 7.25–8.30 | и даже мёдом. | как flow9 | у окошка | банка | — | snap, thud |
| 8.30–9.20 | — | КУЛЬМИНАЦИЯ: её лапа скидывает банку на кучу за решёткой, створка хлопает, нос о створку, зад, пустые лапы | под окошком | створка и пустые лапы | да | LOUDEST flap bang 8.9 |
| 9.20–10.00 | — | КРЮЧОК: ключ в зубы, клешня из окошка вздёргивает | под окошком → вверх | морда с ключом | да | clink, clank |

## Готовые строки "a" (изменённые биты)

0.80–1.40:
`her claw opens, he drops belly-down under her window; her key clinks from his teeth onto her coins; her paw pushes it out through her bars into his paw`

1.40–2.45 (только имена):
`he turns her key in his lock, his round door flies open: his pillow, stump, jar; mouth free`

3.30–4.00:
`her claw plucks her key from his lock, drops it on her coin stack behind her bars, clack; he lunges after it, sprawls out of his burrow`

4.00–5.45 (только имена):
`her claw grabs his collar, jerks him back-first to her bank in two hops, legs paddling; face to camera, mouth free`

5.45–5.95 (только имена):
`her claw opens; he flies back into his burrow onto his pillow`

6.60–7.25:
`close-up, one unbroken shot: her claw snatches his pillow off him, his head knocks his stump in the foreground; his pillow zips into her window onto her counter by her key, clack`

8.30–9.20 (кульминация):
`close-up: her paw flicks his jar onto his pillow and her key behind her bars, flap bangs; he lunges, nose bonks the flap, bounces onto his rump, paws empty`

9.20–10.00 (крючок, hook: loop):
`close-up, no cut: her paw pushes her key ring between his jaws, bit out sideways; her claw shoots out of her window, grabs his collar, jerks him up, legs paddling; key in teeth to the end`

Поле "c" бита 4.00–5.45: `her safe edge in frame` → `her bank pillar in frame`.
Остальные "a" и все "c" — дословно flow9.

## Владельцы по битам

| t | ключ | подушка | банка | клешня/лапа |
|---|---|---|---|---|
| 0.00 | her key, в его зубах | his, в норе | his, в норе | her claw держит его |
| 0.80 | her key: зубы → её монеты → его лапа | нора | нора | her claw, her paw |
| 1.40 | her key в его замке | нора | нора | — |
| 3.30 | her key на её стопке за решёткой | нора | нора | her claw |
| 4.00–6.60 | её стопка | his, под ним | нора | her claw |
| 6.60 | её прилавок | his pillow → её прилавок | нора | her claw |
| 7.25 | прилавок | прилавок | his jar в его лапах | her claw |
| 8.30 | прилавок | прилавок | his jar → её прилавок | her paw |
| 9.20 | her key: её лапа → его зубы | прилавок | прилавок | her paw, her claw |

## Знаки

0.80: +3 зн. к flow9; 1.40: −2; 3.30: +36; 4.00: −1; 5.45: −2; 6.60: +23; 8.30: +7;
крючок: +18; "c" 4.00: +1. Итого ≈ +83 к "a"/"c". Если оператору не хватает — первым
откатить 3.30 до `her claw plucks her key from his lock into her window, clack; he lunges
after it, sprawls out of his burrow` (+4 вместо +36). 8.30 не трогать.
