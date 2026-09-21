#!/usr/bin/env bash
# Sourced by the database workflows. Turns the SUPABASE_DB_URL secret into
# DB_URL. The secret may hold either
#   - the full session-pooler URI
#     postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
#   - or only the database password; the rest is not secret and is filled in
#     from SUPABASE_DB_USER / SUPABASE_DB_HOST (defaults: this project's
#     session pooler in eu-central-1).
# Whitespace, newlines, surrounding quotes and a leading "psql " are
# tolerated. The value is never printed; on refusal the shape it saw is
# described so the secret can be fixed without guessing.
v=$(printf '%s' "${SUPABASE_DB_URL:-}" | tr -d '\r\n')
v="${v#"${v%%[![:space:]]*}"}"
v="${v%"${v##*[![:space:]]}"}"
v="${v#psql }"
v="${v#\'}"; v="${v%\'}"
v="${v#\"}"; v="${v%\"}"
v="${v#"${v%%[![:space:]]*}"}"
v="${v%"${v##*[![:space:]]}"}"

case "$v" in
  postgresql://*|postgres://*) ;;
  *)
    sp=no; at=no; scheme=no
    case "$v" in *[[:space:]]*) sp=yes ;; esac
    case "$v" in *@*) at=yes ;; esac
    case "$v" in *://*) scheme=yes ;; esac
    if [ "$sp" = no ] && [ "$at" = no ] && [ "$scheme" = no ] && [ "${#v}" -ge 8 ]; then
      # a bare password: build the URI around it
      user="${SUPABASE_DB_USER:-postgres.rmisfrxsnhdpcxqzmicy}"
      host="${SUPABASE_DB_HOST:-aws-0-eu-central-1.pooler.supabase.com:5432/postgres}"
      enc=$(printf '%s' "$v" | jq -sRr @uri)
      v="postgresql://${user}:${enc}@${host}"
      echo "SUPABASE_DB_URL holds only the password; connecting as ${user} through ${host%%[:/]*}"
    else
      echo "::error::SUPABASE_DB_URL is neither a postgresql:// URI nor a bare password (length ${#v}, has '://': $scheme, has '@': $at, has whitespace: $sp)"
      exit 1
    fi
    ;;
esac
host=$(printf '%s' "$v" | sed -E 's#^[a-z]+://##; s#^[^@]*@##; s#[/:?].*$##')
echo "db host: $host"
export DB_URL="$v"
