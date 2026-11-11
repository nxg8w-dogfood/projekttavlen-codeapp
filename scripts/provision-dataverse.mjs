#!/usr/bin/env node
// Creates the Projekttavlen tables in a Dataverse environment, inside an unmanaged solution.
// Safe to re-run: anything that already exists is skipped.
//
//   az login --allow-no-subscriptions
//   node scripts/provision-dataverse.mjs https://<org>.crm4.dynamics.com
//
// Creates publisher "itm8 Project Board" (prefix i8pb, choice value prefix 10000), solution "Project Board",
// and tables i8pb_project and i8pb_task (lookup to project with cascade delete).
import { execFileSync } from 'node:child_process';

const envUrl = (process.argv[2] ?? '').replace(/\/+$/, '');
if (!/^https:\/\/[\w.-]+\.dynamics\.com$/.test(envUrl)) {
  console.error('Usage: node scripts/provision-dataverse.mjs https://<org>.crm4.dynamics.com');
  process.exit(1);
}

const PREFIX = 'i8pb';
const OPTION_PREFIX = 10000; // choice values become 100000000 + index, as the app expects
const SOLUTION = 'ProjectBoard';
const SOLUTION_NAME = 'Project Board';

const phases = ['Tilbudsfase', 'PFA-fase', 'Prototype / indkøring'];
const statuses = ['Opgave', 'I gang', 'Pause', 'Done'];
const types = ['Teknisk gennemgang', 'BOM tilgængelighed', 'Kalkulation', 'Quoting', 'Stykliste', 'Stencil / panel',
  'Instruktioner', 'SMD program', 'Selectiv program', 'Kick off', 'Debug SMD', 'Debug HMT', 'Debug rapport'];

const token = execFileSync('az', ['account', 'get-access-token', '--resource', envUrl, '--query', 'accessToken', '-o', 'tsv'], { encoding: 'utf8' }).trim();
const api = `${envUrl}/api/data/v9.2`;
let LANG = 1033; // replaced by the org's base language below
let solutionReady = false; // metadata is added to the solution only once it exists

async function call(method, path, body, extraHeaders = {}) {
  const res = await fetch(`${api}/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json; charset=utf-8',
      'OData-MaxVersion': '4.0',
      'OData-Version': '4.0',
      ...(solutionReady ? { 'MSCRM.SolutionUniqueName': SOLUTION } : {}),
      ...extraHeaders,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 404 && method === 'GET') return null;
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}\n${text}`);
  return text ? JSON.parse(text) : { entityId: res.headers.get('OData-EntityId') };
}

const label = text => ({
  '@odata.type': 'Microsoft.Dynamics.CRM.Label',
  LocalizedLabels: [{ '@odata.type': 'Microsoft.Dynamics.CRM.LocalizedLabel', Label: text, LanguageCode: LANG }],
});
const required = level => ({ Value: level, CanBeChanged: true, ManagedPropertyLogicalName: 'canmodifyrequirementlevelsettings' });

const string = (name, display, maxLength, level = 'None') => ({
  '@odata.type': 'Microsoft.Dynamics.CRM.StringAttributeMetadata',
  SchemaName: `${PREFIX}_${name}`, DisplayName: label(display), RequiredLevel: required(level),
  MaxLength: maxLength, FormatName: { Value: 'Text' },
});
const choice = (name, display, options) => ({
  '@odata.type': 'Microsoft.Dynamics.CRM.PicklistAttributeMetadata',
  SchemaName: `${PREFIX}_${name}`, DisplayName: label(display), RequiredLevel: required('ApplicationRequired'),
  OptionSet: {
    '@odata.type': 'Microsoft.Dynamics.CRM.OptionSetMetadata', IsGlobal: false, OptionSetType: 'Picklist',
    Options: options.map((text, i) => ({ Value: OPTION_PREFIX * 10000 + i, Label: label(text) })),
  },
});

async function ensurePublisherAndSolution() {
  const existing = await call('GET', `publishers?$select=publisherid,uniquename,customizationoptionvalueprefix&$filter=customizationprefix eq '${PREFIX}'`);
  let publisher = existing.value[0];
  if (publisher && publisher.customizationoptionvalueprefix !== OPTION_PREFIX) {
    throw new Error(`Publisher ${publisher.uniquename} already uses prefix "${PREFIX}" with choice value prefix ${publisher.customizationoptionvalueprefix}. `
      + `The app expects ${OPTION_PREFIX}; change CHOICE_BASE in src/lib/board-store.ts and OPTION_PREFIX here to match.`);
  }
  if (!publisher) {
    await call('POST', 'publishers', {
      uniquename: 'itm8ProjectBoard', friendlyname: 'itm8 Project Board', customizationprefix: PREFIX, customizationoptionvalueprefix: OPTION_PREFIX,
    });
    publisher = (await call('GET', `publishers?$select=publisherid,uniquename&$filter=customizationprefix eq '${PREFIX}'`)).value[0];
    console.log(`+ publisher ${publisher.uniquename}`);
  } else console.log(`= publisher ${publisher.uniquename}`);

  const solution = await call('GET', `solutions?$select=solutionid&$filter=uniquename eq '${SOLUTION}'`);
  if (!solution.value.length) {
    await call('POST', 'solutions', {
      uniquename: SOLUTION, friendlyname: SOLUTION_NAME, version: '1.0.0.0',
      'publisherid@odata.bind': `/publishers(${publisher.publisherid})`,
    });
    console.log(`+ solution ${SOLUTION_NAME}`);
  } else console.log(`= solution ${SOLUTION_NAME}`);
  solutionReady = true;
}

async function ensureTable(logicalName, display, plural, primaryName) {
  if (await call('GET', `EntityDefinitions(LogicalName='${logicalName}')?$select=LogicalName`)) {
    console.log(`= table ${logicalName}`);
    return;
  }
  await call('POST', 'EntityDefinitions', {
    '@odata.type': 'Microsoft.Dynamics.CRM.EntityMetadata',
    SchemaName: logicalName, DisplayName: label(display), DisplayCollectionName: label(plural), Description: label(`Projekttavlen: ${display}`),
    OwnershipType: 'UserOwned', HasActivities: false, HasNotes: false, IsActivity: false,
    Attributes: [{ ...primaryName, IsPrimaryName: true }],
  });
  console.log(`+ table ${logicalName}`);
}

async function ensureColumn(table, attribute) {
  const logical = attribute.SchemaName.toLowerCase();
  if (await call('GET', `EntityDefinitions(LogicalName='${table}')/Attributes(LogicalName='${logical}')?$select=LogicalName`)) {
    console.log(`= column ${table}.${logical}`);
    return;
  }
  await call('POST', `EntityDefinitions(LogicalName='${table}')/Attributes`, attribute);
  console.log(`+ column ${table}.${logical}`);
}

async function ensureProjectLookup() {
  const name = `${PREFIX}_project_task`;
  if (await call('GET', `RelationshipDefinitions(SchemaName='${name}')?$select=SchemaName`)) {
    console.log(`= relationship ${name}`);
    return;
  }
  await call('POST', 'RelationshipDefinitions', {
    '@odata.type': 'Microsoft.Dynamics.CRM.OneToManyRelationshipMetadata',
    SchemaName: name, ReferencedEntity: `${PREFIX}_project`, ReferencingEntity: `${PREFIX}_task`,
    CascadeConfiguration: { Assign: 'NoCascade', Share: 'NoCascade', Unshare: 'NoCascade', Reparent: 'NoCascade', Delete: 'Cascade', Merge: 'NoCascade' },
    Lookup: {
      '@odata.type': 'Microsoft.Dynamics.CRM.LookupAttributeMetadata',
      SchemaName: `${PREFIX}_Project`, DisplayName: label('Projekt'), RequiredLevel: required('ApplicationRequired'),
    },
  });
  console.log(`+ relationship ${name} (lookup ${PREFIX}_project on ${PREFIX}_task)`);
}

LANG = (await call('GET', 'organizations?$select=languagecode')).value[0].languagecode;
await ensurePublisherAndSolution();
await ensureTable(`${PREFIX}_project`, 'Projekt', 'Projekter', string('name', 'Projekt / produkt', 120, 'ApplicationRequired'));
await ensureTable(`${PREFIX}_task`, 'Opgave', 'Opgaver', string('name', 'Opgavetype', 120, 'ApplicationRequired'));
await ensureProjectLookup();
await ensureColumn(`${PREFIX}_task`, choice('type', 'Opgavetype', types));
await ensureColumn(`${PREFIX}_task`, choice('phase', 'Fase', phases));
await ensureColumn(`${PREFIX}_task`, choice('status', 'Status', statuses));
await ensureColumn(`${PREFIX}_task`, string('responsible', 'Ansvarlig', 120));
await ensureColumn(`${PREFIX}_task`, {
  '@odata.type': 'Microsoft.Dynamics.CRM.DateTimeAttributeMetadata',
  SchemaName: `${PREFIX}_due`, DisplayName: label('Deadline'), RequiredLevel: required('None'),
  Format: 'DateOnly', DateTimeBehavior: { Value: 'DateOnly' },
});
await ensureColumn(`${PREFIX}_task`, {
  '@odata.type': 'Microsoft.Dynamics.CRM.DecimalAttributeMetadata',
  SchemaName: `${PREFIX}_hours`, DisplayName: label('Forventet forbrug (timer)'), RequiredLevel: required('None'),
  MinValue: 0, MaxValue: 100000, Precision: 2,
});

await call('POST', 'PublishAllXml', {});
console.log('Published. Tables are ready.');
