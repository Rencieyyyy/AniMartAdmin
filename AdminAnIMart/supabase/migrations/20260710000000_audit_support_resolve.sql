-- ============================================================================
-- AniMart Admin — audit conversation resolutions (Customer Service)
--
-- Extends the trigger-only audit trail (20260709002000) to record when an
-- admin marks a support conversation as resolved. The Customer Service page's
-- "Mark resolved" button bulk-updates every support_messages row for a user to
-- status='closed', so a naive row-level trigger would log one entry per
-- message. Instead this is a STATEMENT-level trigger using transition tables:
-- it logs a single 'conversation.resolve' per distinct conversation (user_id)
-- whose messages actually transitioned into 'closed'.
--
-- Like every audit trigger here it is SECURITY DEFINER and delegates to
-- public.log_admin_action, which no-ops unless the JWT maps to an admin — so a
-- user re-opening their own thread (they carry no admin JWT) is never logged.
-- ============================================================================

create or replace function public.audit_support_resolve()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
    r record;
begin
    -- One entry per conversation whose messages were just closed. The
    -- `old.status is distinct from 'closed'` guard means re-resolving an
    -- already-closed thread (no real transition) records nothing.
    for r in
        select distinct n.user_id
          from new_rows n
          join old_rows o on o.id = n.id
         where n.status = 'closed'
           and o.status is distinct from 'closed'
    loop
        perform public.log_admin_action(
            'conversation.resolve', 'conversation', r.user_id::text,
            jsonb_build_object(
                'name',  (select u.name  from public.users u where u.id = r.user_id),
                'email', (select u.email from public.users u where u.id = r.user_id)
            )
        );
    end loop;
    return null;
end
$fn$;

drop trigger if exists trg_audit_support_resolve on public.support_messages;
create trigger trg_audit_support_resolve
    after update on public.support_messages
    referencing old table as old_rows new table as new_rows
    for each statement
    execute function public.audit_support_resolve();
