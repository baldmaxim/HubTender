// Скрипт для создания таблицы notifications и добавления тестовых данных
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

async function createNotificationsTable() {
  try {
    console.log('🔄 Создание таблицы notifications...');

    // SQL для создания таблицы notifications
    const { error: createError } = await supabase.rpc('exec_sql', {
      sql: `
        -- Table: public.notifications
        -- Description: Системные уведомления для пользователей
        CREATE TABLE IF NOT EXISTS public.notifications (
            id uuid NOT NULL DEFAULT gen_random_uuid(),
            type text NOT NULL CHECK (type IN ('success', 'info', 'warning', 'pending')),
            title text NOT NULL,
            message text NOT NULL,
            related_entity_type text,
            related_entity_id uuid,
            is_read boolean NOT NULL DEFAULT false,
            created_at timestamp with time zone NOT NULL DEFAULT now(),
            CONSTRAINT notifications_pkey PRIMARY KEY (id)
        );

        COMMENT ON TABLE public.notifications IS 'Системные уведомления для пользователей';
        COMMENT ON COLUMN public.notifications.id IS 'Уникальный идентификатор уведомления';
        COMMENT ON COLUMN public.notifications.type IS 'Тип уведомления (success, info, warning, pending)';
        COMMENT ON COLUMN public.notifications.title IS 'Заголовок уведомления';
        COMMENT ON COLUMN public.notifications.message IS 'Текст уведомления';
        COMMENT ON COLUMN public.notifications.related_entity_type IS 'Тип связанной сущности (tender, position, cost, etc.)';
        COMMENT ON COLUMN public.notifications.related_entity_id IS 'ID связанной сущности';
        COMMENT ON COLUMN public.notifications.is_read IS 'Признак прочтения уведомления';
        COMMENT ON COLUMN public.notifications.created_at IS 'Дата и время создания';
      `
    });

    if (createError) {
      // Если rpc не существует, используем прямой SQL запрос
      console.log('⚠️ RPC недоступен, используем прямой SQL запрос...');

      const { error } = await supabase.from('_migrations').select('*').limit(1);

      if (error) {
        console.log('ℹ️ Таблица может уже существовать или требуется создать вручную');
        console.log('📋 Выполните следующий SQL в Supabase SQL Editor:');
        console.log(`
-- Table: public.notifications
CREATE TABLE IF NOT EXISTS public.notifications (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    type text NOT NULL CHECK (type IN ('success', 'info', 'warning', 'pending')),
    title text NOT NULL,
    message text NOT NULL,
    related_entity_type text,
    related_entity_id uuid,
    is_read boolean NOT NULL DEFAULT false,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT notifications_pkey PRIMARY KEY (id)
);

COMMENT ON TABLE public.notifications IS 'Системные уведомления для пользователей';
        `);
      }
    } else {
      console.log('✅ Таблица notifications успешно создана');
    }

    // Добавляем тестовые уведомления
    await insertSampleNotifications();

  } catch (error) {
    console.error('❌ Ошибка:', error);
  }
}

async function insertSampleNotifications() {
  try {
    console.log('\n🔄 Добавление тестовых уведомлений...');

    const sampleNotifications = [
      {
        type: 'success',
        title: 'Тендер успешно создан',
        message: 'Новый тендер "Строительство офисного здания" добавлен в систему',
        related_entity_type: 'tender',
        is_read: false
      },
      {
        type: 'info',
        title: 'Обновление данных',
        message: 'Обновлены курсы валют',
        is_read: false
      },
      {
        type: 'warning',
        title: 'Требуется внимание',
        message: 'У тендера "Реконструкция склада" истекает срок подачи',
        related_entity_type: 'tender',
        is_read: false
      },
      {
        type: 'pending',
        title: 'Ожидание проверки',
        message: 'Расчет затрат по тендеру "Монтаж оборудования" готов к проверке',
        related_entity_type: 'tender',
        is_read: true
      },
      {
        type: 'success',
        title: 'Позиции обновлены',
        message: 'Успешно обновлено 25 позиций заказчика в тендере "Ремонт помещений"',
        related_entity_type: 'position',
        is_read: false
      }
    ];

    const { data, error } = await supabase
      .from('notifications')
      .insert(sampleNotifications)
      .select();

    if (error) {
      console.error('❌ Ошибка добавления уведомлений:', error);
      return;
    }

    console.log(`✅ Успешно добавлено ${data.length} тестовых уведомлений`);
    console.log('\n📋 Добавленные уведомления:');
    data.forEach((notif, index) => {
      console.log(`${index + 1}. [${notif.type}] ${notif.title}`);
    });

  } catch (error) {
    console.error('❌ Ошибка:', error);
  }
}

// Запускаем скрипт
createNotificationsTable();
