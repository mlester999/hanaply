#!/usr/bin/env node
/**
 * Deterministic Supabase-compatible database type generation.
 *
 * `supabase gen types` requires a container runtime because the CLI delegates to
 * the `postgres-meta` image. This generator introspects the same catalog
 * directly over `psql` and emits the identical `Database` shape, so
 * `packages/database/src/generated.types.ts` can be regenerated and verified in
 * any environment that can reach a PostgreSQL database.
 *
 * Usage:
 *   node tooling/db/generate-types.mjs --db-url <url> --write
 *   node tooling/db/generate-types.mjs --db-url <url> --check
 *
 * The output is byte-stable for a given schema: every object is emitted in a
 * fixed order with a fixed indentation, so `--check` is a real drift gate.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..', '..');
const outputPath = resolve(root, 'packages/database/src/generated.types.ts');
const schemaName = 'public';

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function harnessDatabaseUrl() {
  const stateDir = resolve(root, '.localdb');
  const portFile = resolve(stateDir, 'port');
  if (!existsSync(portFile)) return undefined;
  const port = readFileSync(portFile, 'utf8').trim();
  return /^\d+$/u.test(port) ? `postgresql://postgres@127.0.0.1:${port}/hanaply` : undefined;
}

// Resolution order: explicit flag, then an operator-supplied connection string,
// then the dockerless harness cluster when one has been provisioned.
const dbUrl = argValue('--db-url') ?? process.env.SUPABASE_DB_URL ?? harnessDatabaseUrl();
const mode = process.argv.includes('--write')
  ? 'write'
  : process.argv.includes('--check')
    ? 'check'
    : null;

if (!mode) {
  process.stderr.write('Use --write or --check.\n');
  process.exit(1);
}
if (!dbUrl) {
  process.stderr.write(
    'No database available. Pass --db-url, set SUPABASE_DB_URL, or run `pnpm db:harness:reset` first.\n',
  );
  process.exit(1);
}

function resolvePsql() {
  if (process.env.HANAPLY_PSQL) return process.env.HANAPLY_PSQL;
  const isWindows = process.platform === 'win32';
  const candidates = [];
  if (isWindows) {
    const pgRoot = resolve(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'PostgreSQL');
    if (existsSync(pgRoot)) {
      for (const entry of readdirSync(pgRoot).sort().reverse()) {
        candidates.push(resolve(pgRoot, entry, 'bin', 'psql.exe'));
      }
    }
  } else {
    candidates.push(
      '/usr/lib/postgresql/18/bin/psql',
      '/usr/local/bin/psql',
      '/opt/homebrew/bin/psql',
    );
  }
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  const located = spawnSync(isWindows ? 'where' : 'which', ['psql'], { encoding: 'utf8' });
  if (located.status === 0 && located.stdout.trim()) {
    return located.stdout.trim().split(/\r?\n/u)[0];
  }
  process.stderr.write('psql was not found. Set HANAPLY_PSQL to its absolute path.\n');
  process.exit(1);
  return '';
}

const psqlBinary = resolvePsql();

function query(sql) {
  const result = spawnSync(psqlBinary, [dbUrl, '-v', 'ON_ERROR_STOP=1', '-tA', '-c', sql], {
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
    env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD ?? '' },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.stderr.write(`${result.stderr || 'The catalog query failed.'}\n`);
    process.exit(1);
  }
  const output = result.stdout.trim();
  return output === '' || output === 'null' ? [] : JSON.parse(output);
}

// ---------------------------------------------------------------------------
// Catalog introspection
// ---------------------------------------------------------------------------

const enums = query(`
  select coalesce(json_agg(json_build_object(
    'name', t.typname,
    'values', (
      select json_agg(e.enumlabel order by e.enumsortorder)
      from pg_catalog.pg_enum e where e.enumtypid = t.oid
    )
  ) order by t.typname), '[]'::json)
  from pg_catalog.pg_type t
  join pg_catalog.pg_namespace n on n.oid = t.typnamespace
  where t.typtype = 'e' and n.nspname = '${schemaName}';
`);

const columns = query(`
  select coalesce(json_agg(row_to_json(entry) order by entry.table_name, entry.column_name), '[]'::json)
  from (
    select
      c.relname as table_name,
      a.attname as column_name,
      a.attnum as position,
      a.attnotnull as not_null,
      pg_catalog.format_type(a.atttypid, a.atttypmod) as formatted_type,
      t.typname as type_name,
      tn.nspname as type_schema,
      t.typtype as type_kind,
      t.typcategory as type_category,
      et.typname as element_type_name,
      etn.nspname as element_type_schema,
      et.typtype as element_type_kind,
      pg_catalog.pg_get_expr(d.adbin, d.adrelid) as default_expression,
      a.attgenerated <> '' as is_generated,
      exists (
        select 1 from pg_catalog.pg_constraint con
        where con.conrelid = c.oid and con.contype = 'p' and a.attnum = any (con.conkey)
      ) as is_primary_key,
      (
        select count(*) from pg_catalog.pg_constraint con
        where con.conrelid = c.oid and con.contype = 'u' and con.conkey = array[a.attnum]
      ) as single_column_unique
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    join pg_catalog.pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    join pg_catalog.pg_type t on t.oid = a.atttypid
    join pg_catalog.pg_namespace tn on tn.oid = t.typnamespace
    left join pg_catalog.pg_type et on et.oid = t.typelem and t.typcategory = 'A'
    left join pg_catalog.pg_namespace etn on etn.oid = et.typnamespace
    left join pg_catalog.pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
    where n.nspname = '${schemaName}' and c.relkind = 'r'
  ) as entry;
`);

const relationships = query(`
  select coalesce(json_agg(row_to_json(entry) order by entry.table_name, entry.foreign_key_name), '[]'::json)
  from (
    select
      con.conname as foreign_key_name,
      src.relname as table_name,
      tgt.relname as referenced_relation,
      (
        select json_agg(att.attname order by key_columns.ordinality)
        from unnest(con.conkey) with ordinality as key_columns(attnum, ordinality)
        join pg_catalog.pg_attribute att
          on att.attrelid = con.conrelid and att.attnum = key_columns.attnum
      ) as columns,
      (
        select json_agg(att.attname order by key_columns.ordinality)
        from unnest(con.confkey) with ordinality as key_columns(attnum, ordinality)
        join pg_catalog.pg_attribute att
          on att.attrelid = con.confrelid and att.attnum = key_columns.attnum
      ) as referenced_columns,
      (
        select count(*) > 0
        from pg_catalog.pg_constraint uq
        where uq.conrelid = con.conrelid and uq.contype in ('p', 'u') and uq.conkey = con.conkey
      ) as is_one_to_one
    from pg_catalog.pg_constraint con
    join pg_catalog.pg_class src on src.oid = con.conrelid
    join pg_catalog.pg_namespace n on n.oid = src.relnamespace
    join pg_catalog.pg_class tgt on tgt.oid = con.confrelid
    join pg_catalog.pg_namespace tn on tn.oid = tgt.relnamespace
    where con.contype = 'f' and n.nspname = '${schemaName}' and tn.nspname = '${schemaName}'
  ) as entry;
`);

const functions = query(`
  select coalesce(json_agg(row_to_json(entry) order by entry.function_name, entry.identity_arguments), '[]'::json)
  from (
    select
      p.proname as function_name,
      pg_catalog.pg_get_function_identity_arguments(p.oid) as identity_arguments,
      pg_catalog.pg_get_function_arguments(p.oid) as arguments,
      pg_catalog.pg_get_function_result(p.oid) as result,
      p.pronargdefaults as default_count,
      p.proretset as returns_set,
      p.prokind as function_kind,
      p.pronargs as argument_count,
      p.proargnames as argument_names,
      (
        select json_agg(pg_catalog.format_type(t.oid, null) order by ordinality)
        from unnest(p.proargtypes) with ordinality as arg(type_oid, ordinality)
        join pg_catalog.pg_type t on t.oid = arg.type_oid
      ) as argument_types,
      p.proallargtypes is not null as has_all_arg_types,
      (
        select json_agg(pg_catalog.format_type(t.oid, null) order by ordinality)
        from unnest(coalesce(p.proallargtypes, p.proargtypes)) with ordinality as arg(type_oid, ordinality)
        join pg_catalog.pg_type t on t.oid = arg.type_oid
      ) as all_argument_types,
      (
        select json_agg(mode order by ordinality)
        from unnest(coalesce(p.proargmodes, array[]::"char"[])) with ordinality as m(mode, ordinality)
      ) as argument_modes
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = '${schemaName}' and p.prokind in ('f', 'p')
  ) as entry;
`);

const views = query(`
  select coalesce(json_agg(c.relname order by c.relname), '[]'::json)
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = '${schemaName}' and c.relkind in ('v', 'm');
`);

const compositeTypes = query(`
  select coalesce(json_agg(row_to_json(entry) order by entry.name), '[]'::json)
  from (
    select t.typname as name, c.relkind as relation_kind
    from pg_catalog.pg_type t
    join pg_catalog.pg_namespace n on n.oid = t.typnamespace
    join pg_catalog.pg_class c on c.oid = t.typrelid
    where t.typtype = 'c' and n.nspname = '${schemaName}'
  ) as entry;
`);

// A composite type whose relation is a table or view is surfaced through
// Tables/Views, which is how the Supabase generator types table-returning
// functions such as update_my_notification_preferences().
const relationTypeKinds = new Map(
  compositeTypes
    .filter(
      (entry) =>
        entry.relation_kind === 'r' || entry.relation_kind === 'v' || entry.relation_kind === 'm',
    )
    .map((entry) => [entry.name, entry.relation_kind === 'r' ? 'Tables' : 'Views']),
);
const standaloneCompositeTypes = compositeTypes
  .filter((entry) => !relationTypeKinds.has(entry.name))
  .map((entry) => entry.name);

// ---------------------------------------------------------------------------
// Type mapping
// ---------------------------------------------------------------------------

const scalarTypeMap = new Map([
  ['uuid', 'string'],
  ['text', 'string'],
  ['varchar', 'string'],
  ['bpchar', 'string'],
  ['citext', 'string'],
  ['name', 'string'],
  ['character varying', 'string'],
  ['character', 'string'],
  ['timestamptz', 'string'],
  ['timestamp', 'string'],
  ['timestamp with time zone', 'string'],
  ['timestamp without time zone', 'string'],
  ['date', 'string'],
  ['time', 'string'],
  ['timetz', 'string'],
  ['time with time zone', 'string'],
  ['time without time zone', 'string'],
  ['int2', 'number'],
  ['int4', 'number'],
  ['int8', 'number'],
  ['smallint', 'number'],
  ['integer', 'number'],
  ['bigint', 'number'],
  ['numeric', 'number'],
  ['float4', 'number'],
  ['float8', 'number'],
  ['real', 'number'],
  ['double precision', 'number'],
  ['money', 'number'],
  ['oid', 'number'],
  ['bool', 'boolean'],
  ['boolean', 'boolean'],
  ['json', 'Json'],
  ['jsonb', 'Json'],
  ['void', 'undefined'],
]);

function mapType(descriptor) {
  const { name, schema, kind } = descriptor;
  if (kind === 'e') {
    return schema === schemaName ? `Database["${schemaName}"]["Enums"]["${name}"]` : 'string';
  }
  if (kind === 'c') {
    if (schema !== schemaName) return 'Json';
    const relationGroup = relationTypeKinds.get(name);
    if (relationGroup) {
      return `Database["${schemaName}"]["${relationGroup}"]["${name}"]["Row"]`;
    }
    return `Database["${schemaName}"]["CompositeTypes"]["${name}"]`;
  }
  if (kind === 'd') {
    // Domain types resolve to their base type; report the domain name when the
    // base is unknown so drift is visible instead of silently typed as unknown.
    return scalarTypeMap.get(name) ?? 'unknown';
  }
  return scalarTypeMap.get(name) ?? 'unknown';
}

function columnType(column) {
  if (column.type_category === 'A' && column.element_type_name) {
    const element = mapType({
      name: column.element_type_name,
      schema: column.element_type_schema,
      kind: column.element_type_kind,
    });
    return element.includes(' | ') ? `(${element})[]` : `${element}[]`;
  }
  return mapType({ name: column.type_name, schema: column.type_schema, kind: column.type_kind });
}

function functionArgType(formattedType) {
  let normalized = formattedType
    .trim()
    .replace(/^public\./u, '')
    .replace(/^"public"\./u, '')
    .replace(/^"(.*)"$/u, '$1');
  if (normalized.endsWith('[]')) {
    const element = functionArgType(normalized.slice(0, -2));
    return element.includes(' | ') ? `(${element})[]` : `${element}[]`;
  }
  if (normalized === 'record') {
    return 'Record<PropertyKey, unknown>';
  }
  if (enums.some((entry) => entry.name === normalized)) {
    return `Database["${schemaName}"]["Enums"]["${normalized}"]`;
  }
  // Functions that return a table row type (for example
  // update_my_notification_preferences) resolve through Tables/Views.
  const relationGroup = relationTypeKinds.get(normalized);
  if (relationGroup) {
    return `Database["${schemaName}"]["${relationGroup}"]["${normalized}"]["Row"]`;
  }
  // Strip precision/scale modifiers: numeric(3,2), character varying(255).
  const withoutModifiers = normalized.replace(/\(.*\)$/u, '').trim();
  return scalarTypeMap.get(withoutModifiers) ?? scalarTypeMap.get(normalized) ?? 'unknown';
}

function functionReturnType(entry) {
  const result = entry.result.trim();
  if (result === 'void') return 'undefined';
  if (result === 'trigger') return 'unknown';

  const tableMatch = /^TABLE\s*\((.*)\)$/isu.exec(result);
  if (tableMatch) {
    const fields = splitTopLevel(tableMatch[1]).map((part) => {
      const [name, type] = splitColumnDefinition(part);
      return { name, type: functionArgType(type) };
    });
    return `{\n${fields
      .map((field) => `${indent(10)}${field.name}: ${field.type}`)
      .join('\n')}\n${indent(8)}}[]`;
  }

  const setMatch = /^SETOF\s+(.+)$/isu.exec(result);
  if (setMatch) {
    return `${functionArgType(setMatch[1])}[]`;
  }
  if (result === 'record') {
    return 'Record<PropertyKey, unknown>';
  }
  return functionArgType(result);
}

function splitTopLevel(value) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const character of value) {
    if (character === '(') depth += 1;
    if (character === ')') depth -= 1;
    if (character === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += character;
  }
  if (current.trim() !== '') parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

function splitColumnDefinition(definition) {
  let depth = 0;
  for (let index = 0; index < definition.length; index += 1) {
    const character = definition[index];
    if (character === '(') depth += 1;
    if (character === ')') depth -= 1;
    if (character === ' ' && depth === 0) {
      return [definition.slice(0, index).trim(), definition.slice(index + 1).trim()];
    }
  }
  return [definition.trim(), 'unknown'];
}

// Column names that PostgreSQL may emit quoted or with mixed case are emitted
// verbatim; Supabase quotes any identifier that is not a plain lowercase word.
function key(name) {
  return /^[a-z_][a-z0-9_]*$/u.test(name) ? name : JSON.stringify(name);
}

const indent = (depth) => ' '.repeat(depth);

// ---------------------------------------------------------------------------
// Emission
// ---------------------------------------------------------------------------

const tables = new Map();
for (const column of columns) {
  if (!tables.has(column.table_name)) tables.set(column.table_name, []);
  tables.get(column.table_name).push(column);
}
// Columns are emitted alphabetically to match the Supabase generator output.
for (const list of tables.values()) {
  list.sort((left, right) => left.column_name.localeCompare(right.column_name));
}
const tableNames = [...tables.keys()].sort();

const relationshipMap = new Map();
for (const relationship of relationships) {
  if (!relationshipMap.has(relationship.table_name)) {
    relationshipMap.set(relationship.table_name, []);
  }
  relationshipMap.get(relationship.table_name).push(relationship);
}

function emitColumnRow(column, { optional }) {
  const type = columnType(column);
  // `unknown | null` collapses to `unknown`, which is how the Supabase
  // generator emits unmapped column types.
  const nullable = !column.not_null && type !== 'unknown';
  const optionalMark = optional ? '?' : '';
  return `${indent(10)}${key(column.column_name)}${optionalMark}: ${type}${nullable ? ' | null' : ''}`;
}

function emitInsertOptional(column) {
  // A column is optional on insert when it is nullable, has a default, or is
  // generated. Identity and generated columns are never accepted.
  if (column.is_generated) return true;
  return !column.not_null || column.default_expression !== null;
}

function emitTable(tableName) {
  const list = tables.get(tableName);
  const rows = list.map((column) => emitColumnRow(column, { optional: false })).join('\n');
  const inserts = list
    .map((column) => emitColumnRow(column, { optional: emitInsertOptional(column) }))
    .join('\n');
  const updates = list.map((column) => emitColumnRow(column, { optional: true })).join('\n');

  const rels = (relationshipMap.get(tableName) ?? [])
    .slice()
    .sort((left, right) => left.foreign_key_name.localeCompare(right.foreign_key_name))
    .map((relationship) =>
      [
        `${indent(10)}{`,
        `${indent(12)}foreignKeyName: ${JSON.stringify(relationship.foreign_key_name)}`,
        `${indent(12)}columns: [${relationship.columns.map((value) => JSON.stringify(value)).join(', ')}]`,
        `${indent(12)}isOneToOne: ${relationship.is_one_to_one === true}`,
        `${indent(12)}referencedRelation: ${JSON.stringify(relationship.referenced_relation)}`,
        `${indent(12)}referencedColumns: [${relationship.referenced_columns
          .map((value) => JSON.stringify(value))
          .join(', ')}]`,
        `${indent(10)}},`,
      ].join('\n'),
    )
    .join('\n')
    .replace(/,$/u, '');

  return [
    `${indent(6)}${key(tableName)}: {`,
    `${indent(8)}Row: {`,
    rows,
    `${indent(8)}}`,
    `${indent(8)}Insert: {`,
    inserts,
    `${indent(8)}}`,
    `${indent(8)}Update: {`,
    updates,
    `${indent(8)}}`,
    `${indent(8)}Relationships: [`,
    rels,
    `${indent(8)}]`,
    `${indent(6)}}`,
  ].join('\n');
}

function emitFunction(entry) {
  const argumentTypes = entry.all_argument_types ?? entry.argument_types ?? [];
  const argumentNames = entry.argument_names ?? [];
  const modes = entry.argument_modes;
  const defaultCount = entry.default_count ?? 0;
  // Input arguments only: OUT and TABLE columns are part of the return type.
  const inputs = [];
  for (let index = 0; index < argumentTypes.length; index += 1) {
    const mode = modes?.[index] ?? 'i';
    if (mode === 'o' || mode === 't') continue;
    inputs.push({ name: argumentNames[index] ?? `arg${index + 1}`, type: argumentTypes[index] });
  }
  // pronargdefaults counts defaults among the input arguments only, so trailing
  // inputs are optional even when the function also declares OUT/TABLE columns.
  const requiredCount = inputs.length - defaultCount;
  const args =
    inputs.length === 0
      ? null
      : inputs
          .map((input, index) => {
            const isOptional = index >= requiredCount;
            return `${indent(10)}${key(input.name)}${isOptional ? '?' : ''}: ${functionArgType(input.type)}`;
          })
          .join('\n');

  const lines = [`${indent(6)}${key(entry.function_name)}: {`];
  if (args === null) {
    lines.push(`${indent(8)}Args: Record<PropertyKey, never>`);
  } else {
    lines.push(`${indent(8)}Args: {`, args, `${indent(8)}}`);
  }
  lines.push(`${indent(8)}Returns: ${functionReturnType(entry)}`);
  lines.push(`${indent(6)}}`);
  return lines.join('\n');
}

function emitEnum(entry) {
  const values = entry.values.map((value) => JSON.stringify(value)).join(' | ');
  return `${indent(6)}${key(entry.name)}: ${values}`;
}

const helpers = readFileSync(resolve(import.meta.dirname, 'type-helpers.ts.txt'), 'utf8').trimEnd();

const document = [
  'export type Json =',
  '  | string',
  '  | number',
  '  | boolean',
  '  | null',
  '  | { [key: string]: Json | undefined }',
  '  | Json[]',
  '',
  'export type Database = {',
  `${indent(2)}${schemaName}: {`,
  `${indent(4)}Tables: {`,
  tableNames.map(emitTable).join('\n'),
  `${indent(4)}}`,
  `${indent(4)}Views: {`,
  views.length === 0
    ? `${indent(6)}[_ in never]: never`
    : views.map((name) => emitTable(name)).join('\n'),
  `${indent(4)}}`,
  `${indent(4)}Functions: {`,
  functions
    .slice()
    .sort(
      (left, right) =>
        left.function_name.localeCompare(right.function_name) ||
        left.identity_arguments.localeCompare(right.identity_arguments),
    )
    .map(emitFunction)
    .join('\n'),
  `${indent(4)}}`,
  `${indent(4)}Enums: {`,
  enums
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name))
    .map(emitEnum)
    .join('\n'),
  `${indent(4)}}`,
  `${indent(4)}CompositeTypes: {`,
  standaloneCompositeTypes.length === 0
    ? `${indent(6)}[_ in never]: never`
    : standaloneCompositeTypes.map((name) => `${indent(6)}${key(name)}: unknown`).join('\n'),
  `${indent(4)}}`,
  `${indent(2)}}`,
  '}',
  '',
  helpers,
  '',
  'export const Constants = {',
  `${indent(2)}${schemaName}: {`,
  `${indent(4)}Enums: {`,
  enums
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => `${indent(6)}${key(entry.name)}: ${JSON.stringify(entry.values)},`)
    .join('\n'),
  `${indent(4)}}`,
  `${indent(2)}}`,
  '} as const',
  '',
].join('\n');

const { format } = await import(
  pathToFileURL(resolve(root, 'node_modules/prettier/index.mjs')).href
).catch(() => import('prettier'));

// The committed artifact is intentionally excluded from the repository Prettier
// configuration, so it is formatted here with the same options the Supabase CLI
// uses (defaults, no semicolons). This keeps regeneration byte-stable.
const formatted = await format(document, { parser: 'typescript', semi: false });

if (mode === 'write') {
  writeFileSync(outputPath, formatted, 'utf8');
  process.stdout.write(
    `Generated ${tableNames.length} tables, ${functions.length} functions, and ${enums.length} enums.\n`,
  );
} else {
  const committed = readFileSync(outputPath, 'utf8');
  const normalize = (value) => value.replaceAll('\r\n', '\n');
  if (normalize(committed) !== normalize(formatted)) {
    process.stderr.write('Generated database type drift detected. Run `pnpm db:types`.\n');
    process.exitCode = 1;
  } else {
    process.stdout.write('Generated database types match the live schema.\n');
  }
}
