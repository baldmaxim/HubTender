begin;

-- Recalculate BOQ amounts for tender "ЖК Сокольники", version 1.
-- This script is safe for the scenario where only currency rates changed.
--
-- What it does:
-- 1. Recalculates boq_items.total_amount from current tender currency rates.
-- 2. Recalculates commercial sums by scaling existing
--    total_commercial_material_cost / total_commercial_work_cost
--    proportionally to the base-cost change.
-- 3. Deletes saved redistribution results for this tender because they become stale.
--
-- Important:
-- This does NOT recompute commercial split from markup tactics from scratch.
-- It is correct when markup tactic / markup parameters / pricing distribution
-- did not change and only currency rates changed.

drop table if exists _target_tender;
create temp table _target_tender on commit drop as
select
  id,
  title,
  version,
  usd_rate,
  eur_rate,
  cny_rate,
  markup_tactic_id
from public.tenders
where title = 'ЖК Сокольники'
  and coalesce(version, 1) = 1;

do $$
declare
  v_count integer;
begin
  select count(*) into v_count from _target_tender;

  if v_count <> 1 then
    raise exception
      'Expected exactly 1 tender for title=% and version=%; found %',
      'ЖК Сокольники',
      1,
      v_count;
  end if;
end $$;

select * from _target_tender;

with recalculated as (
  select
    bi.id,
    bi.total_amount as old_total_amount,
    bi.total_commercial_material_cost as old_material_cost,
    bi.total_commercial_work_cost as old_work_cost,
    case bi.currency_type
      when 'USD' then coalesce(tt.usd_rate, 0)
      when 'EUR' then coalesce(tt.eur_rate, 0)
      when 'CNY' then coalesce(tt.cny_rate, 0)
      else 1
    end as currency_rate,
    case
      when bi.delivery_price_type = 'не в цене' then
        coalesce(bi.unit_rate, 0) *
        (
          case bi.currency_type
            when 'USD' then coalesce(tt.usd_rate, 0)
            when 'EUR' then coalesce(tt.eur_rate, 0)
            when 'CNY' then coalesce(tt.cny_rate, 0)
            else 1
          end
        ) * 0.03
      when bi.delivery_price_type = 'суммой' then coalesce(bi.delivery_amount, 0)
      else 0
    end as delivery_unit_cost,
    case
      when bi.boq_item_type in ('раб', 'суб-раб', 'раб-комп.') then
        coalesce(bi.quantity, 0) *
        coalesce(bi.unit_rate, 0) *
        (
          case bi.currency_type
            when 'USD' then coalesce(tt.usd_rate, 0)
            when 'EUR' then coalesce(tt.eur_rate, 0)
            when 'CNY' then coalesce(tt.cny_rate, 0)
            else 1
          end
        )
      when bi.boq_item_type in ('мат', 'суб-мат', 'мат-комп.') then
        coalesce(bi.quantity, 0) *
        case
          when bi.parent_work_item_id is not null then 1
          else coalesce(bi.consumption_coefficient, 1)
        end *
        (
          coalesce(bi.unit_rate, 0) *
          (
            case bi.currency_type
              when 'USD' then coalesce(tt.usd_rate, 0)
              when 'EUR' then coalesce(tt.eur_rate, 0)
              when 'CNY' then coalesce(tt.cny_rate, 0)
              else 1
            end
          ) +
          case
            when bi.delivery_price_type = 'не в цене' then
              coalesce(bi.unit_rate, 0) *
              (
                case bi.currency_type
                  when 'USD' then coalesce(tt.usd_rate, 0)
                  when 'EUR' then coalesce(tt.eur_rate, 0)
                  when 'CNY' then coalesce(tt.cny_rate, 0)
                  else 1
                end
              ) * 0.03
            when bi.delivery_price_type = 'суммой' then coalesce(bi.delivery_amount, 0)
            else 0
          end
        )
      else coalesce(bi.total_amount, 0)
    end as new_total_amount
  from public.boq_items bi
  join _target_tender tt on tt.id = bi.tender_id
),
updated as (
  update public.boq_items bi
  set
    total_amount = round(recalculated.new_total_amount::numeric, 2),
    total_commercial_material_cost = case
      when nullif(recalculated.old_total_amount, 0) is not null
        and recalculated.old_material_cost is not null
      then round(
        (
          recalculated.old_material_cost *
          (recalculated.new_total_amount / nullif(recalculated.old_total_amount, 0))
        )::numeric,
        6
      )
      else bi.total_commercial_material_cost
    end,
    total_commercial_work_cost = case
      when nullif(recalculated.old_total_amount, 0) is not null
        and recalculated.old_work_cost is not null
      then round(
        (
          recalculated.old_work_cost *
          (recalculated.new_total_amount / nullif(recalculated.old_total_amount, 0))
        )::numeric,
        6
      )
      else bi.total_commercial_work_cost
    end
  from recalculated
  where bi.id = recalculated.id
  returning
    bi.id,
    recalculated.old_total_amount,
    bi.total_amount as new_total_amount,
    recalculated.old_material_cost,
    bi.total_commercial_material_cost as new_material_cost,
    recalculated.old_work_cost,
    bi.total_commercial_work_cost as new_work_cost
)
select
  count(*) as updated_rows,
  round(sum(old_total_amount)::numeric, 2) as old_base_total,
  round(sum(new_total_amount)::numeric, 2) as new_base_total,
  round(sum(coalesce(old_material_cost, 0) + coalesce(old_work_cost, 0))::numeric, 2) as old_commercial_total,
  round(sum(coalesce(new_material_cost, 0) + coalesce(new_work_cost, 0))::numeric, 2) as new_commercial_total
from updated;

delete from public.cost_redistribution_results
where tender_id in (select id from _target_tender);

commit;
