const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

const userId = 'eafa3aec-d7fa-49e9-9d9d-16650512ea0f';

async function checkUser() {
  console.log('Checking user:', userId);
  console.log('Supabase URL:', supabaseUrl);

  const { data, error } = await supabase
    .from('users')
    .select(`
      *,
      roles:role_code (
        name,
        color
      )
    `)
    .eq('id', userId)
    .single();

  if (error) {
    console.error('❌ Error:', error);
  } else {
    console.log('✅ User data:', JSON.stringify(data, null, 2));
  }

  process.exit(0);
}

checkUser().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
