import type Database from 'better-sqlite3';

export const version = 17;
export const description =
  'Add routing_rules.negative_keywords + retune rules to fix substring mis-routing (FRW-BL-024)';

// Tuned rule values — commit-pinned here AND in framework/routing-rules/seed.json.
// The migration syncs EXISTING DBs (seedRoutingRules only inserts net-new workTypes,
// so example/negative-keyword changes to already-seeded rules must land via migration).
const TUNED: Array<{ workType: string; examples: string[]; negativeKeywords: string[] | null }> = [
  {
    workType: 'authentication',
    examples: ['oauth','jwt','auth','token','login','sign in','sign-in','session','sso','single sign-on','saml','oidc','mfa','two-factor','2fa','password','credentials','rbac','role-based','permissions','acl','access control','identity','authentication','authorization'],
    negativeKeywords: ['clone','octokit','libgit2sharp','gitleaks','cancellationtoken','glob','file enumeration','secret-scan'],
  },
  {
    workType: 'api',
    examples: ['api','rest','restful','endpoint','route','middleware','controller','request','response','status-code','pagination','webhook','websocket','grpc','trpc','openapi','swagger','rate-limit'],
    negativeKeywords: ['gitleaks','secret-scan','secret scanning'],
  },
  {
    workType: 'security',
    examples: ['security','vulnerability','owasp','xss','csrf','injection','sanitize','escape','csp','cors','audit','penetration','pentest','encryption','tls','ssl','certificate','gitleaks','secret-scan','secret scanning','secret detection','leaked secret'],
    negativeKeywords: null,
  },
  {
    workType: 'frontend',
    examples: ['frontend','ui','ux','component','react','vue','svelte','angular','css','tailwind','responsive','animation','layout','design-system','theme','dark-mode','modal','form','input','button','sidebar','navbar','page','admin page','report page'],
    negativeKeywords: null,
  },
  {
    workType: 'data-engineering',
    examples: ['etl','pipeline','data-pipeline','transform','csv','parquet','streaming','kafka','rabbitmq','queue','batch','ingest','warehouse','analytics','data-lake','spark','snapshot','versioned snapshot','manifest','parity benchmark','framework attribution','framework mapping','control mapping','attribution','file enumeration','glob','glob matcher','dependency manifest'],
    negativeKeywords: null,
  },
  {
    workType: 'azure-integration',
    examples: ['apim','api management','logic app','function app','service bus','event grid','event hubs','apim policy','developer portal','api center','subscription key','azure api gateway','hybrid auth','workflow','logicapp'],
    negativeKeywords: null,
  },
  {
    workType: 'azure-devops',
    examples: ['bicep','arm template','bicep deployment','azure pipeline','apiops','azure devops pipeline','azure cli','az module','slot swap','azure policy','azure resource group','azure iac','azure devops','ado','ado repos'],
    negativeKeywords: null,
  },
  {
    workType: 'devops',
    examples: ['docker','dockerfile','compose','ci','cd','pipeline','github-actions','deploy','deployment','nginx','terraform','ansible','kubernetes','k8s','helm','monitoring','prometheus','grafana','env','environment','clone','git clone','octokit','libgit2sharp','repository clone'],
    negativeKeywords: ['gitleaks','secret-scan','secret scanning'],
  },
];

function columnExists(sqlite: Database.Database, table: string, column: string): boolean {
  const rows = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((r) => r.name === column);
}

export function up(sqlite: Database.Database): void {
  // 1. Add the column (idempotent — skip if a prior partial run already added it).
  if (!columnExists(sqlite, 'routing_rules', 'negative_keywords')) {
    sqlite.exec(`ALTER TABLE routing_rules ADD COLUMN negative_keywords TEXT;`);
  }

  // 2. Sync tuned rules into existing rows (no-op on fresh DBs that seed from seed.json,
  //    where the values are already current).
  const update = sqlite.prepare(
    `UPDATE routing_rules
       SET examples = ?, negative_keywords = ?, updated_at = datetime('now')
     WHERE work_type = ?`,
  );
  for (const rule of TUNED) {
    update.run(
      JSON.stringify(rule.examples),
      rule.negativeKeywords ? JSON.stringify(rule.negativeKeywords) : null,
      rule.workType,
    );
  }
}
