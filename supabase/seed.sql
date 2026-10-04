-- ローカル開発用の初期データ。`supabase db reset` のたびに入る（本番には入らない）
-- テスト用アカウント: dev@yabumi.test / yabumi-dev-1234（README にも記載）

do $$
declare
  v_user uuid := '11111111-1111-4111-8111-111111111111';
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token
  ) values (
    '00000000-0000-0000-0000-000000000000', v_user, 'authenticated', 'authenticated',
    'dev@yabumi.test', extensions.crypt('yabumi-dev-1234', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', '{}', now(), now(),
    '', '', '', ''
  );

  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (
    gen_random_uuid(), v_user, v_user::text,
    jsonb_build_object('sub', v_user::text, 'email', 'dev@yabumi.test', 'email_verified', true),
    'email', now(), now(), now()
  );

  insert into public.projects (owner_id, name, description, target_audience, app_store_url, created_at)
  values
    (v_user, 'かけいぼ日和', 'レシートを撮るだけで家計簿がつく。続かない人でも 1 日 10 秒で済む。',
     '家計簿を何度も挫折している 20〜30 代の会社員', 'https://apps.apple.com/jp/app/id1234567890', now() - interval '1 day'),
    (v_user, 'ねむログ', '寝る前にスマホを置くと睡眠を記録する。', '', null, now());
end $$;
