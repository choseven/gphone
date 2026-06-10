create extension if not exists "pgcrypto";

create table if not exists rooms (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  host_id uuid not null,
  is_public boolean not null default false,
  state text not null default 'WAITING',
  mode text not null default 'normal',
  current_round int not null default 0,
  total_rounds int not null default 0,
  phase_ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists players (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  user_id uuid,
  client_id text not null,
  username text not null,
  avatar text not null default '0',
  is_host boolean not null default false,
  is_ready boolean not null default false,
  is_connected boolean not null default true,
  is_spectator boolean not null default false,
  position int not null default 0,
  score int not null default 0,
  last_seen timestamptz not null default now(),
  joined_at timestamptz not null default now()
);

create table if not exists settings (
  room_id uuid primary key references rooms(id) on delete cascade,
  prompt_timer int not null default 40,
  drawing_timer int not null default 120,
  description_timer int not null default 40,
  rounds int not null default 0,
  reveal_speed int not null default 3,
  profanity_filter boolean not null default true,
  anonymous boolean not null default false,
  custom_prompts boolean not null default false,
  public_gallery boolean not null default false,
  late_joining boolean not null default true,
  spectator_mode boolean not null default true,
  canvas_size int not null default 720,
  min_brush int not null default 2,
  max_brush int not null default 60,
  color_restrictions boolean not null default false,
  voting_enabled boolean not null default false,
  vote_duration int not null default 30,
  point_value int not null default 100,
  flow text not null default 'prompt_first'
);

create table if not exists game_states (
  room_id uuid primary key references rooms(id) on delete cascade,
  state text not null default 'WAITING',
  round int not null default 0,
  phase text not null default 'WAITING',
  phase_ends_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists chains (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  owner_player_id uuid not null references players(id) on delete cascade,
  position int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists chain_entries (
  id uuid primary key default gen_random_uuid(),
  chain_id uuid not null references chains(id) on delete cascade,
  room_id uuid not null references rooms(id) on delete cascade,
  author_player_id uuid references players(id) on delete set null,
  step int not null,
  type text not null,
  content text,
  drawing_id uuid,
  created_at timestamptz not null default now(),
  unique (chain_id, step)
);

create table if not exists drawings (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  chain_id uuid references chains(id) on delete cascade,
  author_player_id uuid references players(id) on delete set null,
  data jsonb not null default '{}'::jsonb,
  frames jsonb,
  created_at timestamptz not null default now()
);

create table if not exists votes (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  chain_id uuid references chains(id) on delete cascade,
  entry_id uuid references chain_entries(id) on delete cascade,
  voter_player_id uuid not null references players(id) on delete cascade,
  value int not null default 1,
  created_at timestamptz not null default now(),
  unique (voter_player_id, entry_id)
);

create table if not exists chat_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  player_id uuid references players(id) on delete set null,
  username text not null,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_players_room on players(room_id);
create index if not exists idx_chains_room on chains(room_id);
create index if not exists idx_entries_chain on chain_entries(chain_id);
create index if not exists idx_entries_room on chain_entries(room_id);
create index if not exists idx_drawings_room on drawings(room_id);
create index if not exists idx_votes_room on votes(room_id);
create index if not exists idx_chat_room on chat_messages(room_id);

create or replace function generate_room_code() returns text as $$
declare
  chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result text := '';
  i int;
begin
  for i in 1..5 loop
    result := result || substr(chars, floor(random() * length(chars) + 1)::int, 1);
  end loop;
  return result;
end;
$$ language plpgsql;

create or replace function create_room(p_host_id uuid, p_client_id text, p_username text, p_avatar text, p_is_public boolean)
returns jsonb as $$
declare
  v_code text;
  v_room rooms;
  v_player players;
  v_attempts int := 0;
begin
  loop
    v_code := generate_room_code();
    exit when not exists (select 1 from rooms where code = v_code);
    v_attempts := v_attempts + 1;
    if v_attempts > 25 then raise exception 'could not allocate room code'; end if;
  end loop;

  insert into rooms (code, host_id, is_public, state, mode)
  values (v_code, p_host_id, p_is_public, 'WAITING', 'normal')
  returning * into v_room;

  insert into settings (room_id) values (v_room.id);
  insert into game_states (room_id, state, phase) values (v_room.id, 'WAITING', 'WAITING');

  insert into players (room_id, user_id, client_id, username, avatar, is_host, is_ready)
  values (v_room.id, p_host_id, p_client_id, p_username, p_avatar, true, true)
  returning * into v_player;

  return jsonb_build_object('room', to_jsonb(v_room), 'player', to_jsonb(v_player));
end;
$$ language plpgsql security definer;

create or replace function join_room(p_code text, p_user_id uuid, p_client_id text, p_username text, p_avatar text)
returns jsonb as $$
declare
  v_room rooms;
  v_player players;
  v_count int;
  v_spectator boolean := false;
begin
  select * into v_room from rooms where code = upper(p_code);
  if v_room.id is null then raise exception 'room not found'; end if;

  select * into v_player from players where room_id = v_room.id and client_id = p_client_id;
  if v_player.id is not null then
    update players set is_connected = true, last_seen = now(), username = p_username, avatar = p_avatar
    where id = v_player.id returning * into v_player;
    return jsonb_build_object('room', to_jsonb(v_room), 'player', to_jsonb(v_player), 'rejoined', true);
  end if;

  if v_room.state <> 'WAITING' then
    v_spectator := true;
  end if;

  select count(*) into v_count from players where room_id = v_room.id;

  insert into players (room_id, user_id, client_id, username, avatar, is_spectator, position)
  values (v_room.id, p_user_id, p_client_id, p_username, p_avatar, v_spectator, v_count)
  returning * into v_player;

  return jsonb_build_object('room', to_jsonb(v_room), 'player', to_jsonb(v_player), 'rejoined', false);
end;
$$ language plpgsql security definer;

alter table rooms enable row level security;
alter table players enable row level security;
alter table settings enable row level security;
alter table game_states enable row level security;
alter table chains enable row level security;
alter table chain_entries enable row level security;
alter table drawings enable row level security;
alter table votes enable row level security;
alter table chat_messages enable row level security;

create policy "rooms read" on rooms for select using (true);
create policy "rooms insert" on rooms for insert with check (true);
create policy "rooms update" on rooms for update using (true) with check (true);
create policy "rooms delete" on rooms for delete using (true);

create policy "players read" on players for select using (true);
create policy "players insert" on players for insert with check (true);
create policy "players update" on players for update using (true) with check (true);
create policy "players delete" on players for delete using (true);

create policy "settings read" on settings for select using (true);
create policy "settings insert" on settings for insert with check (true);
create policy "settings update" on settings for update using (true) with check (true);

create policy "game_states read" on game_states for select using (true);
create policy "game_states insert" on game_states for insert with check (true);
create policy "game_states update" on game_states for update using (true) with check (true);

create policy "chains read" on chains for select using (true);
create policy "chains insert" on chains for insert with check (true);
create policy "chains update" on chains for update using (true) with check (true);
create policy "chains delete" on chains for delete using (true);

create policy "entries read" on chain_entries for select using (true);
create policy "entries insert" on chain_entries for insert with check (true);
create policy "entries update" on chain_entries for update using (true) with check (true);

create policy "drawings read" on drawings for select using (true);
create policy "drawings insert" on drawings for insert with check (true);
create policy "drawings update" on drawings for update using (true) with check (true);

create policy "votes read" on votes for select using (true);
create policy "votes insert" on votes for insert with check (true);
create policy "votes update" on votes for update using (true) with check (true);
create policy "votes delete" on votes for delete using (true);

create policy "chat read" on chat_messages for select using (true);
create policy "chat insert" on chat_messages for insert with check (true);

alter publication supabase_realtime add table rooms;
alter publication supabase_realtime add table players;
alter publication supabase_realtime add table settings;
alter publication supabase_realtime add table game_states;
alter publication supabase_realtime add table chains;
alter publication supabase_realtime add table chain_entries;
alter publication supabase_realtime add table drawings;
alter publication supabase_realtime add table votes;
alter publication supabase_realtime add table chat_messages;
