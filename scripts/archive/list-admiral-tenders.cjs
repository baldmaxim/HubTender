const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

(async () => {
  const { data: tenders } = await supabase
    .from('tenders')
    .select('id, title')
    .order('title');

  console.log('All tenders:');
  tenders?.forEach(t => {
    console.log(`${t.title} (${t.id})`);
  });
})();
