/**
 * Хук для парсинга Excel файла новой версии ВОР
 */

import { useState } from 'react';
import { parseExcelForVersion, getParseStatistics, type ParseExcelResult } from '../../../../../utils/parseExcelForVersion';
import type { ParsedRow } from '../../../../../utils/matching';
import { getErrorMessage } from '../../../../../utils/errors';

export interface UseFileParserResult {
  parsedData: ParsedRow[] | null;
  parseResult: ParseExcelResult | null;
  parsing: boolean;
  error: string | null;
  parseFile: (file: File) => Promise<void>;
  reset: () => void;
}

/**
 * Хук для парсинга Excel файла
 *
 * @returns объект с методами и состоянием парсинга
 */
export function useFileParser(): UseFileParserResult {
  const [parsedData, setParsedData] = useState<ParsedRow[] | null>(null);
  const [parseResult, setParseResult] = useState<ParseExcelResult | null>(null);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parseFile = async (file: File) => {
    setParsing(true);
    setError(null);
    setParsedData(null);
    setParseResult(null);

    try {
      // Парсинг файла
      const result = await parseExcelForVersion(file);
      setParseResult(result);

      // Проверка на ошибки
      if (result.errors.length > 0) {
        setError(`Ошибки при парсинге файла:\n${result.errors.join('\n')}`);
        return;
      }

      // Проверка что есть данные
      if (result.positions.length === 0) {
        setError('Файл не содержит позиций');
        return;
      }

      // Получить статистику
      const stats = getParseStatistics(result.positions);
      console.log('Статистика парсинга:', stats);

      // Сохранить данные
      setParsedData(result.positions);

    } catch (err) {
      console.error('Ошибка парсинга Excel:', err);
      setError(`Не удалось прочитать файл: ${getErrorMessage(err)}`);
    } finally {
      setParsing(false);
    }
  };

  const reset = () => {
    setParsedData(null);
    setParseResult(null);
    setParsing(false);
    setError(null);
  };

  return {
    parsedData,
    parseResult,
    parsing,
    error,
    parseFile,
    reset,
  };
}
