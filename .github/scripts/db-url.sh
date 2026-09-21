#!/usr/bin/env bash
# Sourced by the database workflows. Turns the SUPABASE_DB_URL secret into
# DB_URL: trims whitespace, newlines and surrounding quotes, accepts a value
# pasted with a leading "psql ", and refuses anything that is not a
# postgresql:// URI. It never prints the value; on refusal it describes the
# shape it saw so the secret can be fixed in GitHub without guessing.
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
    scheme=no; at=no; sp=no
    case "$v" in *://*) scheme=yes ;; esac
    case "$v" in *@*) at=yes ;; esac
    case "$v" in *[[:space:]]*) sp=yes ;; esac
    echo "::error::SUPABASE_DB_URL is not a postgresql:// URI (length ${#v}, has '://': $scheme, has '@': $at, has whitespace: $sp). Store the plain session-pooler URI: postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres"
    exit 1
    ;;
esac
host=$(printf '%s' "$v" | sed -E 's#^[a-z]+://##; s#^[^@]*@##; s#[/:?].*$##')
echo "db host: $host"
export DB_URL="$v"
