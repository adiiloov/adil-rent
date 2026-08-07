-- Удаление аккаунта должно уносить и данные AdilRent.
--
-- Проект Supabase общий с AdilTranslator, и edge-функция `delete-account`
-- в нём одна на два приложения: она зовёт `delete_account_data`, а потом
-- стирает учётную запись. Написана функция была под переводчик и знала
-- только про его таблицы. Из-за этого «Удалить аккаунт» в AdilRent убивал
-- учётку, но оставлял на сайте объявления человека — с его телефоном,
-- именем и фотографиями. Навсегда: владельца, который мог бы их снять,
-- больше не существовало.
--
-- Здесь функция переписана целиком: сначала прежняя часть переводчика
-- слово в слово, следом — данные аренды. Когда переводчик уедет на свой
-- проект, его половину отсюда надо убрать.

create or replace function public.delete_account_data(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_subject text := 'user:' || p_user_id;
  -- Свой номер на каждое удаление. Общая метка вроде 'deleted' слила бы
  -- корзины разных людей в одну строку на бакет — и упёрлась бы в первичный
  -- ключ (subject, bucket), а до этого испортила бы счёт слушателей в отчётах.
  v_tombstone text := 'deleted:' || gen_random_uuid();
  v_email text;
  v_apt_ids bigint[];
  v_car_ids bigint[];
begin
  -- ─── AdilTranslator ────────────────────────────────────────────────

  -- Право на подписку — единственное, что стирается без следа: оно живёт
  -- ровно для того, чтобы отвечать «этому аккаунту можно», а аккаунта больше
  -- нет. Покупку в App Store это не отменяет, её отменяет Apple.
  delete from public.subscribers where user_id = p_user_id;

  update public.usage_ledger
     set subject = v_tombstone,
         user_id = null
   where subject = v_subject;

  -- Корзины, заведённые на устройство до входа, остаются как были: они и не
  -- указывают на аккаунт. Но если номер аккаунта попал в такую строку, его
  -- надо убрать.
  update public.usage_ledger
     set user_id = null
   where user_id = p_user_id;

  -- Номер устройства здесь тоже лишний: по нему события человека связались бы
  -- с его же следом до входа в аккаунт. Событие остаётся, счёт открытий и
  -- покупок не меняется.
  update public.app_events
     set user_id = null,
         device = null
   where user_id = p_user_id;

  -- ─── AdilRent ──────────────────────────────────────────────────────

  -- Почта нужна до удаления учётки — дальше её взять будет негде.
  select email into v_email from auth.users where id = p_user_id;

  -- Номера объявлений запоминаем заранее: на них ссылаются просмотры,
  -- брони и заказы продвижения, а внешних ключей между ними нет — база
  -- сама эти хвосты не подберёт.
  select coalesce(array_agg(id), '{}') into v_apt_ids
    from public.apartments where user_id = p_user_id;
  select coalesce(array_agg(id), '{}') into v_car_ids
    from public.cars where user_id = p_user_id;

  -- Чужие объявления, которые человек смотрел: строка остаётся, чтобы у
  -- владельцев не поехал счётчик просмотров, но чей это был просмотр —
  -- больше не записано.
  update public.listing_views
     set viewer_id = null
   where viewer_id = p_user_id;

  -- А просмотры его собственных объявлений уходят вместе с ними: считать
  -- показы того, чего нет, незачем.
  delete from public.listing_views
   where (listing_kind = 'apt' and listing_id = any(v_apt_ids))
      or (listing_kind = 'car' and listing_id = any(v_car_ids));

  -- Бронь хранит имя и телефон арендатора, поэтому удаляется с обеих
  -- сторон — и когда уходит хозяин жилья, и когда уходит тот, кто писал.
  delete from public.bookings
   where owner_id = p_user_id
      or renter_id = p_user_id;

  -- Заказы продвижения обезличить нельзя: user_id объявлен NOT NULL, а
  -- переделывать колонку ради удаления аккаунта дороже, чем потерять три
  -- строки истории. Деньги всё равно проходят мимо приложения.
  delete from public.promo_orders
   where user_id = p_user_id
      or (listing_kind = 'apt' and listing_id = any(v_apt_ids))
      or (listing_kind = 'car' and listing_id = any(v_car_ids));

  -- Заявка «ищу жильё» — это имя, телефон и пожелания человека. Уходит целиком.
  delete from public.demand_leads where user_id = p_user_id;

  delete from public.apartments where user_id = p_user_id;
  delete from public.cars where user_id = p_user_id;
  delete from public.profiles where id = p_user_id;

  -- Фотографии из хранилища здесь не трогаем: Supabase держит на
  -- storage.objects триггер protect_delete и отбивает прямое удаление,
  -- чтобы в бакете не оставались файлы без записей. Снимки удаляет само
  -- приложение через Storage API — до вызова этой функции, пока у него
  -- ещё есть живая сессия (см. deleteAccount в index.html).

  -- Карта старых владельцев переносит объявления с прежнего проекта на
  -- новый UUID при первом входе по совпадению почты. Человеку, который
  -- удалил аккаунт, привязывать больше нечего — иначе повторная
  -- регистрация на ту же почту вернула бы ему призраков.
  if v_email is not null then
    delete from private.legacy_owner_map where lower(email) = lower(v_email);
  end if;
end;
$function$;
