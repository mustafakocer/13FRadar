#!/usr/bin/env bash
# Sourced by the database workflows. Turns the SUPABASE_DB_URL secret into
# DB_URL. The secret must hold the full session-pooler URI:
#   postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
# Whitespace, newlines and surrounding quotes are trimmed; anything that is
# not a postgresql:// URI is refused. The value is never printed; on refusal
# the shape it saw is described so the secret can be fixed without guessing.
v=$(printf '%s' "${SUPABASE_DB_URL:-}" | tr -d '\r\n')
v="${v#"${v%%[![:space:]]*}"}"
v="${v%"${v##*[![:space:]]}"}"
v="${v#\'}"; v="${v%\'}"
v="${v#\"}"; v="${v%\"}"
v="${v#"${v%%[![:space:]]*}"}"
v="${v%"${v##*[![:space:]]}"}"

case "$v" in
  postgresql://*@*|postgres://*@*) ;;
  *)
    sp=no; at=no; scheme=no
    case "$v" in *[[:space:]]*) sp=yes ;; esac
    case "$v" in *@*) at=yes ;; esac
    case "$v" in *://*) scheme=yes ;; esac
    echo "::error::SUPABASE_DB_URL must be the full postgresql:// session-pooler URI (got length ${#v}, has '://': $scheme, has '@': $at, has whitespace: $sp). Supabase → Settings → Database → Connection string → Session."
    exit 1
    ;;
esac
host=$(printf '%s' "$v" | sed -E 's#^[a-z]+://##; s#^[^@]*@##; s#[/:?].*$##')
echo "db host: $host"
export DB_URL="$v"
