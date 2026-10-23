-- «Объекты на карте», данные v2 (23.10.2026).
-- Вместо 39 строк по разрешениям на ввод (сид 2026_10_construction_objects.sql)
-- — 23 комплекса с коммерческими названиями (лист «Сводная» файла
-- «Объекты — название, площадь, адрес.xlsx»: площади — сумма РнВ, даты ввода
-- от первого до последнего этапа, точка — центр корпусов) и 35 объектов
-- референс-листа ООО «СУ-10» (14 в работе с привязкой к договору projects,
-- 21 завершённый; адреса — по открытым источникам, у части точка по комплексу).
-- Требует 2026_10_construction_objects_customer.sql. Идемпотентно: заменяет
-- только нетронутый сид (created_by IS NULL) и только если v2 ещё не загружен.

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.construction_objects WHERE name = 'ЖК «Савёловский Сити»') THEN
    RAISE NOTICE 'construction_objects v2 уже загружены — пропуск';
    RETURN;
  END IF;

  DELETE FROM public.construction_objects WHERE created_by IS NULL;

  INSERT INTO public.construction_objects
    (name, area, address, customer, latitude, longitude, status, project_id,
     commissioning_date, commissioning_start_date, sort_order)
  SELECT v.name, v.area, v.address, v.customer, v.lat, v.lon, v.status,
         (SELECT p.id FROM public.projects p WHERE p.name = v.project_name ORDER BY p.is_active DESC LIMIT 1),
         v.date_to, v.date_from, v.sort_order
  FROM (VALUES
    ('Бизнес-центр ВТБ', 29298::numeric, 'Москва, ул. Воронцовская, д. 43, стр. 1', NULL, 55.733101::float8, 37.664875::float8, 'archive', NULL, '2013-12-27'::date, NULL::date, 1),
    ('Блок начальных классов на 125 мест к школе № 1935 (упоминание в письме)', NULL::numeric, 'Москва, ул. Авиаконструктора Миля, вл. 18, корп. 2', NULL, 55.680509::float8, 37.855394::float8, 'archive', NULL, NULL::date, NULL::date, 2),
    ('ДОУ «Загорье»', 6250.9::numeric, 'Москва, ул. Ягодная, д. 14, корп. 1', NULL, 55.58044::float8, 37.677082::float8, 'archive', NULL, '2014-05-31'::date, NULL::date, 3),
    ('Жилой дом («Левобережный», проектный корпус 5)', 15172.9::numeric, 'Москва, ул. Беломорская, д. 8, корп. 1', NULL, 55.86159::float8, 37.469403::float8, 'archive', NULL, '2014-03-28'::date, NULL::date, 4),
    ('Жилой дом с гаражом («Марьина Роща»)', 12417.9::numeric, 'Москва, Старомарьинское шоссе, д. 13', NULL, 55.804819::float8, 37.611663::float8, 'archive', NULL, '2013-12-25'::date, NULL::date, 5),
    ('ЖК «Гринада»', 59071.6::numeric, 'Москва, ул. Феодосийская, д. 7, корп. 1, 5', NULL, 55.56075::float8, 37.576784::float8, 'archive', NULL, '2019-08-09'::date, '2018-12-26'::date, 6),
    ('ЖК «Домашний»', 112319.1::numeric, 'Москва, ул. Донецкая, д. 30, корп. 1, 2', NULL, 55.645951::float8, 37.706177::float8, 'archive', NULL, '2019-01-25'::date, '2018-12-21'::date, 7),
    ('ЖК «Кристалл»', 63757.7::numeric, 'Москва, ул. Смольная, д. 49', NULL, 55.86343::float8, 37.478594::float8, 'archive', NULL, '2015-10-31'::date, NULL::date, 8),
    ('ЖК «Мичуринский»', 273181.4::numeric, 'Москва, Мичуринский проспект, д. 26; ул. Мосфильмовская, д. 53, 55', NULL, 55.701875::float8, 37.498004::float8, 'archive', NULL, '2014-11-28'::date, '2014-06-30'::date, 9),
    ('ЖК «Монолит» / «Дом за Лентой»', 58495.9::numeric, 'Нижний Новгород, слобода Подновье, ул. Лысогорская, д. 89, корп. 3', NULL, 56.299126::float8, 44.084818::float8, 'archive', NULL, '2017-12-29'::date, NULL::date, 10),
    ('ЖК «На Ленинградском шоссе, 108»', 40712.6::numeric, 'Москва, Ленинградское шоссе, д. 108', NULL, 55.860532::float8, 37.46761::float8, 'archive', NULL, '2014-10-31'::date, NULL::date, 11),
    ('ЖК «На Циолковского»', 46895::numeric, 'Москва, ул. Циолковского, д. 7', NULL, 55.82839::float8, 37.448552::float8, 'archive', NULL, '2014-12-26'::date, NULL::date, 12),
    ('ЖК «Новое Ступино»', 8870.3::numeric, 'Московская область, с. Верзилово, ул. Николаевская, д. 65/13, 67/29; школа — улица в РнВ не указана', NULL, 55.034113::float8, 38.10502::float8, 'archive', NULL, '2019-08-01'::date, '2016-11-09'::date, 13),
    ('ЖК «Пресненский Вал, 14»', 80109::numeric, 'Москва, ул. Пресненский Вал, д. 14, корп. 1–6; сооружение 1 (паркинг)', NULL, 55.76685::float8, 37.56595::float8, 'archive', NULL, '2015-12-29'::date, NULL::date, 14),
    ('ЖК «Савёловский Сити»', 187633.4::numeric, 'Москва, ул. Новодмитровская, д. 2, корп. 4, 5, 6, 7; стр. 8 (паркинг)', NULL, 55.80399::float8, 37.590835::float8, 'archive', NULL, '2018-11-09'::date, '2017-01-10'::date, 15),
    ('ЖК «Смольная, 57»', 26598::numeric, 'Москва, ул. Смольная, д. 57, корп. 1', NULL, 55.867763::float8, 37.473553::float8, 'archive', NULL, '2014-03-31'::date, NULL::date, 16),
    ('ЖК LIFE-Ботанический сад', 136800.5::numeric, 'Москва, Лазоревый проезд, д. 1; д. 1А, корп. 1, 2, 3', NULL, 55.848596::float8, 37.63989::float8, 'archive', NULL, '2017-12-30'::date, NULL::date, 17),
    ('ЖК LIFE-Митинская', 85838::numeric, 'Москва, ул. Митинская, д. 28; д. 28, корп. 2 и корп. 2, стр. 1', NULL, 55.845466::float8, 37.368494::float8, 'archive', NULL, '2015-06-08'::date, '2014-12-26'::date, 18),
    ('ЖК LIFE-Митинская ECOPARK', 170978.62::numeric, 'Москва, ул. Митинская, д. 20; д. 28, корп. 3, 4, 5', NULL, 55.844661::float8, 37.372042::float8, 'archive', NULL, '2017-12-20'::date, '2015-12-22'::date, 19),
    ('ЖК PerovSky («ПеровСкай»)', 45503.1::numeric, 'Москва, шоссе Энтузиастов, д. 86А, корп. 1, 2, 3', NULL, 55.76386::float8, 37.798152::float8, 'archive', NULL, '2018-03-27'::date, NULL::date, 20),
    ('ЖК SREDA («Среда»)', 87527.4::numeric, 'Москва, Рязанский проспект, д. 2/1, корп. 3, 4', NULL, 55.727419::float8, 37.739211::float8, 'archive', NULL, '2019-10-08'::date, '2019-08-29'::date, 21),
    ('СОШ «Загорье»', 19592.2::numeric, 'Москва, ул. Михневская, д. 8, корп. 2', NULL, 55.577515::float8, 37.671546::float8, 'archive', NULL, '2014-07-31'::date, NULL::date, 22),
    ('ЦОД ВТБ', 3216.7::numeric, 'Москва, Перовское шоссе, д. 1, стр. 2', NULL, 55.733891::float8, 37.73471::float8, 'archive', NULL, '2016-09-19'::date, NULL::date, 23),
    ('ЖК «City Bay», квартал Indian Ocean', 171000::numeric, 'Москва, Волоколамское шоссе, 95/2', 'МР Групп', 55.829875::float8, 37.402837::float8, 'current', NULL, NULL::date, NULL::date, 101),
    ('ЖК «ЗИЛАРТ», ЗИЛАРТ GRAND', 188000::numeric, 'Москва, бульвар Братьев Весниных, 4', 'ГК ЛСР', 55.696408::float8, 37.636701::float8, 'current', 'ЛОТ 18, 19, 27', NULL::date, NULL::date, 102),
    ('ЖК «WAVE», 2-я очередь', 80000::numeric, 'Москва, ул. Борисовские Пруды, 1', 'ГК ЛСР', 55.636978::float8, 37.706528::float8, 'current', 'ЖК WAVE 2', NULL::date, NULL::date, 103),
    ('ЖК «Stories на Мосфильмовской»', 39000::numeric, 'Москва, ул. Мосфильмовская, 100', 'October Group', 55.698278::float8, 37.471523::float8, 'current', 'ЖК Stories', NULL::date, NULL::date, 104),
    ('ЖК «King & Sons Residence»', 17000::numeric, 'Москва, ул. Мосфильмовская, 31А', 'October Group', 55.711757::float8, 37.513101::float8, 'current', 'ЖК KING&SONS', NULL::date, NULL::date, 105),
    ('ЖК «INJOY»', 136000::numeric, 'Москва, ул. Адмирала Макарова', 'ИНГРАД', 55.832313::float8, 37.494655::float8, 'current', 'ЖК INJOY', NULL::date, NULL::date, 106),
    ('ЖК «Дом 56»', 56000::numeric, 'Москва, ул. Фридриха Энгельса, 56', 'ГАЛС-Девелопмент', 55.777081::float8, 37.692609::float8, 'current', 'ЖК Дом56', NULL::date, NULL::date, 107),
    ('ЖК «ALIA»', 110000::numeric, 'Москва, ул. Лётная, 95Б', 'Астерус Девелопмент', 55.820234::float8, 37.421891::float8, 'current', 'ЖК ALIA', NULL::date, NULL::date, 108),
    ('ЖК «Садовническая 69»', 44000::numeric, 'Москва, Садовническая наб., 69', 'Балчуг Эстейт', 55.738586::float8, 37.640369::float8, 'current', 'ЖК Садовническая, 69', NULL::date, NULL::date, 109),
    ('Клубный город на реке Primavera, квартал Bellini', 105000::numeric, 'Москва, Волоколамское шоссе, вл. 71/12, корп. 14', 'ООО «СЗ «Стадион Спартак»', 55.813375::float8, 37.428551::float8, 'current', 'ЖК Примавера К14', NULL::date, NULL::date, 110),
    ('ЖК «Событие», корпус 6.2', 77000::numeric, 'Москва, ул. Лобачевского, вл. 114', 'ДОНСТРОЙ', 55.694866::float8, 37.477525::float8, 'current', 'ЖК Событие 6.2', NULL::date, NULL::date, 111),
    ('ЖК «ЗИЛАРТ», МАРК (Дом 33)', 67000::numeric, 'Москва, бульвар Братьев Весниных', 'ГК ЛСР', 55.689674::float8, 37.633877::float8, 'current', 'ЖК ЛОТ 33', NULL::date, NULL::date, 112),
    ('ЖК «Событие», корпус 6.1', 67000::numeric, 'Москва, ул. Лобачевского, вл. 114', 'ДОНСТРОЙ', 55.694866::float8, 37.477525::float8, 'current', 'ЖК Событие 6.1', NULL::date, NULL::date, 113),
    ('ЖК «ЗИЛАРТ», Лот 31', 69000::numeric, 'Москва, ЖК «ЗИЛАРТ» (лот 31, точка приблизительная)', 'ГК ЛСР', 55.697224::float8, 37.636980::float8, 'current', 'Лот 31', NULL::date, NULL::date, 114),
    ('Клубный город на реке Primavera, квартал Vivaldi', 106000::numeric, 'Москва, Волоколамское шоссе, вл. 71/12, корп. 13', 'ООО «СЗ «Стадион Спартак»', 55.813375::float8, 37.428551::float8, 'archive', NULL, NULL::date, NULL::date, 115),
    ('МФК «Метрополия», очередь 3.0', 83000::numeric, 'Москва, Волгоградский проспект, вл. 32', 'МР Групп', 55.720638::float8, 37.693486::float8, 'archive', NULL, NULL::date, NULL::date, 116),
    ('ЖК «Событие-2»', 67000::numeric, 'Москва, ул. Лобачевского, вл. 114', 'ДОНСТРОЙ', 55.695441::float8, 37.477848::float8, 'archive', NULL, NULL::date, NULL::date, 117),
    ('Клубный город на реке Primavera, квартал Rossini', 39000::numeric, 'Москва, Волоколамское шоссе, вл. 71/12, корп. 22', 'ООО «СЗ «Стадион Спартак»', 55.813375::float8, 37.428551::float8, 'archive', NULL, NULL::date, NULL::date, 118),
    ('МФК «Метрополия», очередь 1.2', 84000::numeric, 'Москва, Волгоградский проспект, 32/5, корп. 3', 'МР Групп', 55.721106::float8, 37.688099::float8, 'archive', NULL, NULL::date, NULL::date, 119),
    ('МФК «Метрополия», очередь 2.0', 90000::numeric, 'Москва, Волгоградский проспект, вл. 32/5', 'МР Групп', 55.720230::float8, 37.689350::float8, 'archive', NULL, NULL::date, NULL::date, 120),
    ('ЖК «City Bay», квартал Atlantic Ocean', 116000::numeric, 'Москва, Волоколамское шоссе, 95–97', 'МР Групп', 55.830591::float8, 37.402295::float8, 'archive', NULL, NULL::date, NULL::date, 121),
    ('ЖК «Сиреневый парк», 3-я очередь', 86000::numeric, 'Москва, ул. Тагильская, 2, корп. 1', 'AFI Development', 55.818034::float8, 37.749391::float8, 'archive', NULL, NULL::date, NULL::date, 122),
    ('ЖК «TopHills»', 118000::numeric, 'Москва, Электролитный проезд, 7', 'ИНГРАД', 55.673398::float8, 37.609469::float8, 'archive', NULL, NULL::date, NULL::date, 123),
    ('ЖК «Павелецкая Сити»', 78000::numeric, 'Москва, ул. Дубининская, вл. 59–69', 'МР Групп', 55.717750::float8, 37.636170::float8, 'archive', NULL, NULL::date, NULL::date, 124),
    ('ЖК «Селигер Сити», кварталы Ван Гог и Кандинский', 56000::numeric, 'Москва, Ильменский проезд, вл. 14', 'МР Групп', 55.861806::float8, 37.543644::float8, 'archive', NULL, NULL::date, NULL::date, 125),
    ('ЖК «Настоящее»', 227000::numeric, 'Москва, ул. Винницкая, вл. 8', 'НИИМосстрой', 55.701338::float8, 37.493165::float8, 'archive', NULL, NULL::date, NULL::date, 126),
    ('ЖК «Огни-2»', 95000::numeric, 'Москва, ул. Лобачевского (ЖК «Огни»)', 'ДОНСТРОЙ', 55.696707::float8, 37.476740::float8, 'archive', NULL, NULL::date, NULL::date, 127),
    ('ЖК «Discovery Park»', 122000::numeric, 'Москва, ул. Дыбенко, 7/1', 'МР Групп', 55.878768::float8, 37.478755::float8, 'archive', NULL, NULL::date, NULL::date, 128),
    ('ЖК «Селигер Сити», кварталы Брюллов, Репин, Беринг', 116000::numeric, 'Москва, Ильменский проезд, вл. 14', 'МР Групп', 55.861806::float8, 37.543644::float8, 'archive', NULL, NULL::date, NULL::date, 129),
    ('МФК «Метрополия», очередь 1.1', 143000::numeric, 'Москва, Волгоградский проспект, вл. 32/5', 'МР Групп', 55.720230::float8, 37.689350::float8, 'archive', NULL, NULL::date, NULL::date, 130),
    ('ЖК «Сиреневый парк», 2-я очередь', 101000::numeric, 'Москва, ул. Тагильская, вл. 4', 'AFI Development', 55.817054::float8, 37.751474::float8, 'archive', NULL, NULL::date, NULL::date, 131),
    ('ЖК «Селигер Сити», кварталы Рембрандт, Рубенс, Баренц', 105000::numeric, 'Москва, Ильменский проезд, 14, корп. 7–8', 'МР Групп', 55.862376::float8, 37.543432::float8, 'archive', NULL, NULL::date, NULL::date, 132),
    ('ЖК «Discovery»', 107000::numeric, 'Москва, ул. Беломорская, 23', 'МР Групп', 55.867206::float8, 37.482550::float8, 'archive', NULL, NULL::date, NULL::date, 133),
    ('ЖК «LIFE-Кутузовский», 2-я очередь', 90000::numeric, 'Москва, ул. Гжатская, 5, корп. 6–10', 'ГК "ПИОНЕР"', 55.714476::float8, 37.433779::float8, 'archive', NULL, NULL::date, NULL::date, 134),
    ('ЖК «Сиреневый парк», 1-я очередь', 61000::numeric, 'Москва, ул. Тагильская, вл. 4', 'AFI Development', 55.817054::float8, 37.751474::float8, 'archive', NULL, NULL::date, NULL::date, 135)
  ) AS v(name, area, address, customer, lat, lon, status, project_name, date_to, date_from, sort_order);
END $$;

COMMIT;
