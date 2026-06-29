/**
 * Общие форматтеры чисел для ru-RU. `Intl.NumberFormat` создаётся ОДИН раз на модуль
 * и переиспользуется — это в разы быстрее повторного `value.toLocaleString('ru-RU', …)`
 * в render-колбэках таблиц (горячий путь, тысячи вызовов на рендер крупного тендера).
 *
 * Вывод побитово совпадает с прежними вызовами:
 * - formatRu(n)  ≡ n.toLocaleString('ru-RU')                                  (0..3 знака)
 * - formatRu2(n) ≡ n.toLocaleString('ru-RU', {min/maxFractionDigits: 2})      (ровно 2 знака)
 */

const nfDefault = new Intl.NumberFormat('ru-RU');
const nf2 = new Intl.NumberFormat('ru-RU', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Число в ru-RU с дефолтной точностью (как `toLocaleString('ru-RU')`). */
export function formatRu(value: number): string {
  return nfDefault.format(value);
}

/** Число в ru-RU ровно с 2 знаками после запятой. */
export function formatRu2(value: number): string {
  return nf2.format(value);
}
