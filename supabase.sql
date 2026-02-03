-- USERS
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  tg_user_id bigint unique not null,
  language text not null default 'uz',

  location_code text,
  lat double precision,
  lng double precision,

  -- preferences
  notify_prayers boolean not null default true,
  notify_ramadan boolean not null default true,
  notify_daily_morning boolean not null default true,
  notify_daily_evening boolean not null default true,

  step text not null default 'LANG',
  temp_parent text,   -- onboarding navigation (region/district)
  updated_at timestamptz default now(),
  created_at timestamptz default now()
);

-- LOCATIONS (viloyat/tuman/shahar tree)
create table if not exists locations (
  code text primary key,
  parent_code text,
  level text not null check (level in ('region','district','city')),
  name_uz text not null,
  lat double precision,
  lng double precision
);

-- RAMADAN PERIOD (har yil qo'lda kiritiladi)
create table if not exists ramadan_periods (
  id bigserial primary key,
  starts_on date not null,
  ends_on date not null
);

-- NOTIFICATIONS QUEUE
create type notification_status as enum ('pending','processing','sent','failed');

create table if not exists notifications (
  id bigserial primary key,
  tg_user_id bigint not null,
  scheduled_at timestamptz not null,
  kind text not null,        -- 'prayer_fajr'...'prayer_isha' | 'suhoor' | 'iftar' | 'daily_morning' | 'daily_evening'
  payload jsonb not null default '{}',
  status notification_status not null default 'pending',
  locked_at timestamptz,
  sent_at timestamptz,
  error text,
  created_at timestamptz default now()
);

create unique index if not exists notifications_unique
  on notifications (tg_user_id, kind, scheduled_at);

-- CLAIM FUNCTION (parallel cronlarda to'qnashmaslik uchun)
create or replace function claim_due_notifications(p_limit int)
returns setof notifications
language plpgsql
as $$
begin
  return query
  with cte as (
    select id
    from notifications
    where status='pending' and scheduled_at <= now()
    order by scheduled_at asc
    limit p_limit
    for update skip locked
  )
  update notifications n
  set status='processing', locked_at=now()
  from cte
  where n.id = cte.id
  returning n.*;
end;
$$;
