// Проверить формат затрат в БД
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://vswxtmkdsimwgmvzysdo.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZzd3h0bWtkc2ltd2dtdnp5c2RvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI0MTYzNTAsImV4cCI6MjA3Nzk5MjM1MH0.sCtBZL_pH8knNrFJqfx7uPMLlos_9HAzkaArlpOyfDY'
);

async function checkCostCategories() {
  // Получить все затраты, связанные с ВИС и электрикой
  const { data: costs } = await supabase
    .from('detail_cost_categories')
    .select(`
      id,
      name,
      location,
      cost_categories (name)
    `)
    .or('name.ilike.%Электрик%,name.ilike.%Огнезащита%')
    .order('name');

  console.log('=== ЗАТРАТЫ С "ЭЛЕКТРИК" ИЛИ "ОГНЕЗАЩИТА" В НАЗВАНИИ ===\n');

  costs?.forEach(cost => {
    const categoryName = cost.cost_categories?.name || '';
    const fullPath = `${categoryName} / ${cost.name} / ${cost.location}`;

    console.log(`ID: ${cost.id}`);
    console.log(`Категория: ${categoryName}`);
    console.log(`Детальная категория: ${cost.name}`);
    console.log(`Локация: ${cost.location}`);
    console.log(`Полный путь: ${fullPath}`);
    console.log('---\n');
  });

  // Проверить конкретно ВИС
  console.log('\n=== ЗАТРАТЫ ПОД КАТЕГОРИЕЙ "ВИС" ===\n');

  const { data: visCosts } = await supabase
    .from('detail_cost_categories')
    .select(`
      id,
      name,
      location,
      cost_categories (name)
    `)
    .eq('cost_categories.name', 'ВИС')
    .order('name');

  visCosts?.forEach(cost => {
    const categoryName = cost.cost_categories?.name || '';
    const fullPath = `${categoryName} / ${cost.name} / ${cost.location}`;

    console.log(`Детальная: ${cost.name}`);
    console.log(`Локация: ${cost.location}`);
    console.log(`Путь: ${fullPath}\n`);
  });

  // Искать точное совпадение из примера пользователя
  console.log('\n=== ПОИСК: "Электрика - силовая. Огнезащита" ===\n');

  const { data: exactMatch } = await supabase
    .from('detail_cost_categories')
    .select(`
      id,
      name,
      location,
      cost_categories (name)
    `)
    .ilike('name', '%Электрика - силовая%');

  if (exactMatch && exactMatch.length > 0) {
    exactMatch.forEach(cost => {
      console.log('Найдено:');
      console.log(`  Категория: ${cost.cost_categories?.name}`);
      console.log(`  Детальная: ${cost.name}`);
      console.log(`  Локация: ${cost.location}`);
    });
  } else {
    console.log('Не найдено точного совпадения');

    // Попробуем найти части
    const { data: parts } = await supabase
      .from('detail_cost_categories')
      .select(`
        id,
        name,
        location,
        cost_categories (name)
      `)
      .or('name.ilike.%силовая%,name.ilike.%Огнезащита%');

    console.log('\nНайдено по частям:');
    parts?.forEach(cost => {
      console.log(`  ${cost.cost_categories?.name} / ${cost.name} / ${cost.location}`);
    });
  }
}

checkCostCategories();
