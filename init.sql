DROP TABLE IF EXISTS models;

CREATE TABLE models (
  id serial unique not null,
  name text unique not null,
  urls text[] not null default array[]::text[],
  primary key (id)
);
