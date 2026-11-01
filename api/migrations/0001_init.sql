CREATE TABLE homes (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CONSTRAINT homes_name_nonempty CHECK (length(trim(name)) BETWEEN 1 AND 200)
);

CREATE TABLE members (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL CONSTRAINT members_id_unique UNIQUE,
  home_id TEXT NOT NULL,
  name TEXT NOT NULL CONSTRAINT members_name_nonempty CHECK (length(trim(name)) BETWEEN 1 AND 200),
  CONSTRAINT members_home_fk FOREIGN KEY (home_id) REFERENCES homes(id),
  CONSTRAINT members_home_id_unique UNIQUE (home_id, id)
);
CREATE INDEX members_home_order ON members(home_id, sequence);

CREATE TABLE bills (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL CONSTRAINT bills_id_unique UNIQUE,
  home_id TEXT NOT NULL,
  title TEXT NOT NULL CONSTRAINT bills_title_nonempty CHECK (length(trim(title)) BETWEEN 1 AND 200),
  total_cents INTEGER NOT NULL CONSTRAINT bills_total_positive CHECK (
    typeof(total_cents) = 'integer' AND total_cents BETWEEN 1 AND 9007199254740991
  ),
  CONSTRAINT bills_home_fk FOREIGN KEY (home_id) REFERENCES homes(id),
  CONSTRAINT bills_home_id_unique UNIQUE (home_id, id)
);
CREATE INDEX bills_home_order ON bills(home_id, sequence);

CREATE TABLE shares (
  id TEXT PRIMARY KEY NOT NULL,
  home_id TEXT NOT NULL,
  bill_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CONSTRAINT shares_amount_nonnegative CHECK (
    typeof(amount_cents) = 'integer' AND amount_cents BETWEEN 0 AND 9007199254740991
  ),
  paid_at TEXT,
  payment_key TEXT,
  CONSTRAINT shares_bill_fk FOREIGN KEY (home_id, bill_id) REFERENCES bills(home_id, id),
  CONSTRAINT shares_member_fk FOREIGN KEY (home_id, member_id) REFERENCES members(home_id, id),
  CONSTRAINT shares_one_per_member UNIQUE (bill_id, member_id),
  CONSTRAINT shares_payment_pair CHECK (
    (paid_at IS NULL AND payment_key IS NULL) OR
    (paid_at IS NOT NULL AND payment_key IS NOT NULL AND length(trim(payment_key)) > 0)
  )
);
CREATE INDEX shares_member_unpaid ON shares(home_id, member_id) WHERE paid_at IS NULL;
