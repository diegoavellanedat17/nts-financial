begin;
-- Preserve the bank's exact COP amount on imported receipts; display stays in whole pesos.
alter table public.transactions drop constraint transactions_currency_precision_check;
alter table public.transactions add constraint transactions_currency_precision_check check (
 (currency='COP' and amount=trunc(amount) and reserved=trunc(reserved)) or
 (currency='COP' and (balance_check_id is not null or transfer_id is not null or reference like 'gmail:%') and amount=round(amount,2) and reserved=0) or
 (currency='USD' and amount=round(amount,2) and reserved=round(reserved,2))
);
commit;
