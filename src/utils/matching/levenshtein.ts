/**
 * Алгоритм Левенштейна для вычисления расстояния редактирования между строками
 *
 * Вычисляет минимальное количество операций (вставка, удаление, замена) необходимых
 * для преобразования одной строки в другую
 *
 * Используется для определения схожести наименований работ при сопоставлении версий
 */

/**
 * Ядро: расстояние Левенштейна по двум уже нормализованным строкам.
 *
 * Используется rolling-реализация на двух 1D-строках вместо полной 2D-матрицы:
 * O(min(len1,len2)) памяти, заметно меньше аллокаций. Результат бит-в-бит совпадает
 * с классической матричной реализацией.
 *
 * @param s1 - первая строка (предполагается уже нормализованной)
 * @param s2 - вторая строка (предполагается уже нормализованной)
 * @returns расстояние редактирования
 */
export function levenshteinDistanceNormalized(s1: string, s2: string): number {
  const len1 = s1.length;
  const len2 = s2.length;

  if (len1 === 0) return len2;
  if (len2 === 0) return len1;

  let prev = new Array<number>(len2 + 1);
  let curr = new Array<number>(len2 + 1);

  for (let j = 0; j <= len2; j++) {
    prev[j] = j;
  }

  for (let i = 1; i <= len1; i++) {
    curr[0] = i;
    const c1 = s1.charCodeAt(i - 1);

    for (let j = 1; j <= len2; j++) {
      const cost = c1 === s2.charCodeAt(j - 1) ? 0 : 1;

      const del = prev[j] + 1; // удаление
      const ins = curr[j - 1] + 1; // вставка
      const sub = prev[j - 1] + cost; // замена

      let min = del < ins ? del : ins;
      if (sub < min) min = sub;
      curr[j] = min;
    }

    const tmp = prev;
    prev = curr;
    curr = tmp;
  }

  return prev[len2];
}

/**
 * Вычислить расстояние Левенштейна между двумя строками
 *
 * Публичный контракт сохранён: строки приводятся к нижнему регистру и обрезаются.
 *
 * @param str1 - первая строка
 * @param str2 - вторая строка
 * @returns расстояние редактирования (минимальное количество операций)
 */
export function levenshteinDistance(str1: string, str2: string): number {
  // Нормализация: приведение к нижнему регистру и обрезка пробелов
  const s1 = str1.toLowerCase().trim();
  const s2 = str2.toLowerCase().trim();

  return levenshteinDistanceNormalized(s1, s2);
}
