require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkBoqItem() {
  const itemId = '75cf2cb4-9910-4c82-a0f1-89c725fdc407';
  
  const { data: item, error } = await supabase
    .from('boq_items')
    .select('*')
    .eq('id', itemId)
    .single();
  
  if (error) {
    console.error('Error:', error);
    return;
  }
  
  console.log('\n=== BOQ Item ===');
  console.log('ID:', item.id);
  console.log('Type:', item.boq_item_type);
  console.log('Quantity:', item.quantity);
  console.log('Unit Rate:', item.unit_rate);
  console.log('Currency:', item.currency_type);
  console.log('Delivery Type:', item.delivery_price_type);
  console.log('Delivery Amount:', item.delivery_amount);
  console.log('Total Amount (DB):', item.total_amount);
  
  // Recalculate
  const { data: tender } = await supabase
    .from('tenders')
    .select('usd_rate, eur_rate, cny_rate')
    .eq('id', item.tender_id)
    .single();
  
  const getCurrencyRate = (currency) => {
    switch(currency) {
      case 'USD': return tender.usd_rate || 1;
      case 'EUR': return tender.eur_rate || 1;
      case 'CNY': return tender.cny_rate || 1;
      default: return 1;
    }
  };
  
  const rate = getCurrencyRate(item.currency_type);
  const unitRate = item.unit_rate || 0;
  const quantity = item.quantity || 0;
  
  let deliveryPrice = 0;
  if (item.delivery_price_type === 'не в цене') {
    deliveryPrice = unitRate * rate * 0.03;
  } else if (item.delivery_price_type === 'суммой') {
    deliveryPrice = item.delivery_amount || 0;
  }
  
  const calculatedTotal = quantity * (unitRate * rate + deliveryPrice);
  
  console.log('\n=== Calculation ===');
  console.log('Currency Rate:', rate);
  console.log('Unit Price in RUB:', unitRate * rate);
  console.log('Delivery Price:', deliveryPrice);
  console.log('Formula: qty × (unit_rate × rate + delivery)');
  console.log(`${quantity} × (${unitRate} × ${rate} + ${deliveryPrice})`);
  console.log('Calculated Total:', calculatedTotal.toFixed(2));
  console.log('\n=== Difference ===');
  console.log('Difference:', (calculatedTotal - item.total_amount).toFixed(2));
}

checkBoqItem().then(() => process.exit(0));
