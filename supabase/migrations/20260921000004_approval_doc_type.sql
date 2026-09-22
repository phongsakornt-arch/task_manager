-- Split approval documents into two categories: documents proposed for
-- signature (sign) vs. disbursement/expense approval (disbursement).
alter table public.approval_documents
  add column if not exists doc_type text not null default 'sign'
  check (doc_type in ('sign', 'disbursement'));
