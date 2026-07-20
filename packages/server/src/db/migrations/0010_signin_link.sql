-- Passwordless sign-in links: a third single-use email-token purpose.
-- Same table/machinery as verify_email + password_reset (0006); only the
-- purpose CHECK needs widening.
ALTER TABLE email_tokens DROP CONSTRAINT email_tokens_purpose_check;
ALTER TABLE email_tokens
  ADD CONSTRAINT email_tokens_purpose_check
  CHECK (purpose IN ('verify_email', 'password_reset', 'signin'));
