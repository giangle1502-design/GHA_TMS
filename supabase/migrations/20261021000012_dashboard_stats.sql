-- =============================================================================
-- Số liệu biểu đồ trang Tổng quan, tính trực tiếp từ bảng chuyến (không lưu bảng tổng hợp).
-- security invoker: RLS của shipments / transport_orders / customers vẫn áp dụng cho người gọi.
-- =============================================================================

create or replace function public.dashboard_shipment_stats(p_today date default (now() at time zone 'Asia/Ho_Chi_Minh')::date)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with s as (
    select sh.status,
           (sh.pickup_at at time zone 'Asia/Ho_Chi_Minh')::date as d,
           o.customer_id
    from public.shipments sh
    join public.transport_orders o on o.id = sh.order_id
    where sh.pickup_at >= ((date_trunc('month', p_today) - interval '5 months')::date)::timestamp at time zone 'Asia/Ho_Chi_Minh'
      and sh.pickup_at < ((p_today + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh')
  ),
  live as (select * from s where status <> 'cancelled'),
  month_start as (select date_trunc('month', p_today)::date as m),
  prev as (
    -- cùng kỳ tháng trước: từ ngày 1 đến cùng ngày (hoặc ngày cuối tháng nếu tháng trước ngắn hơn)
    select (date_trunc('month', p_today) - interval '1 month')::date as m0,
           least((date_trunc('month', p_today) - interval '1 month')::date + (extract(day from p_today)::int - 1),
                 (date_trunc('month', p_today) - interval '1 day')::date) as m1
  )
  select jsonb_build_object(
    'today', (select count(*) from live where d = p_today),
    'yesterday', (select count(*) from live where d = p_today - 1),
    'month_to_date', (select count(*) from live, month_start where d >= m),
    'prev_month_to_date', (select count(*) from live, prev where d between m0 and m1),
    'completed_mtd', (select count(*) from live, month_start where d >= m and status in ('driver_completed', 'closed')),
    'completed_prev_mtd', (select count(*) from live, prev where d between m0 and m1 and status in ('driver_completed', 'closed')),
    'daily', (
      select jsonb_agg(jsonb_build_object('date', g.ts::date, 'total', coalesce(c.n, 0)) order by g.ts)
      from generate_series((p_today - 13)::timestamp, p_today::timestamp, interval '1 day') as g(ts)
      left join (select d, count(*) as n from live group by d) c on c.d = g.ts::date
    ),
    'monthly', (
      select jsonb_agg(jsonb_build_object('month', to_char(g.m, 'YYYY-MM'), 'total', coalesce(c.n, 0), 'completed', coalesce(c.done, 0)) order by g.m)
      from generate_series(date_trunc('month', p_today::timestamp) - interval '5 months', date_trunc('month', p_today::timestamp), interval '1 month') as g(m)
      left join (
        select date_trunc('month', d::timestamp) as m, count(*) as n, count(*) filter (where status in ('driver_completed', 'closed')) as done
        from live group by 1
      ) c on c.m = g.m
    ),
    'by_status', (
      select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
      from (select status, count(*) as n from s, month_start where d >= m group by status) x
    ),
    'top_customers', (
      select coalesce(jsonb_agg(jsonb_build_object('id', x.customer_id, 'name', coalesce(c.name, 'Khách hàng'), 'total', x.n) order by x.n desc, c.name), '[]'::jsonb)
      from (
        select customer_id, count(*) as n from live, month_start where d >= m group by customer_id order by n desc limit 5
      ) x
      left join public.customers c on c.id = x.customer_id
    )
  );
$$;

revoke all on function public.dashboard_shipment_stats(date) from public, anon;
grant execute on function public.dashboard_shipment_stats(date) to authenticated;
