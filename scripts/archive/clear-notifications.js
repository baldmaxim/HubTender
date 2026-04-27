// Скрипт для очистки демо-уведомлений из таблицы notifications
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

// Загружаем переменные окружения
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Отсутствуют переменные окружения VITE_SUPABASE_URL или SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function clearNotifications() {
  try {
    console.log('🔄 Очистка демо-уведомлений...');

    // Удаляем все уведомления
    const { error } = await supabase
      .from('notifications')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000'); // Удаляем все записи

    if (error) {
      console.error('❌ Ошибка очистки:', error);
      return;
    }

    console.log('✅ Все уведомления успешно удалены');
    console.log('ℹ️ Теперь колокол уведомлений будет пустым');

  } catch (error) {
    console.error('❌ Ошибка:', error);
  }
}

// Запускаем скрипт
clearNotifications();
