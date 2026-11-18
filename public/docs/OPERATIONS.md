# Operations and deployment

## Build and package

```sh
npm ci
npm test
npm run build
```

The build emits `dist/server/index.js`, the client output, `.openai/hosting.json` and Drizzle migrations. The source hosting manifest identifies the existing Site; preserve that ID. D1 uses the `DB` binding and R2 uses `BUCKET`. Static assets are embedded into the Worker so the server artifact does not rely on a separate asset binding.

Push the exact source state and package the corresponding build before saving a Sites version. Apply schema migrations through the hosting deployment flow. Never create or alter schema during HTTP requests. Seed data is idempotent application data inserted only after an authenticated administrator bootstrap.

Sites setup/source helpers were unavailable in this environment. `scripts/publish-source.mjs` is a fallback source push and packaging helper; it reads credentials through hidden stdin and uses an ephemeral environment for Git authentication. Do not commit credentials, local databases or `.local/` files.

## Identity and launch

Keep the Site owner-private for initialization. Open the app once as the owner to bind the owner ID in settings. Before broader enrollment, configure the Site audience to permit the selected students; the app’s enrollment list is an additional check. Public site metadata should not be treated as private storage.

The production Worker assumes the Sites trusted identity boundary. For a different host, replace it with a real identity verifier and remove trust in raw browser-supplied headers. The local development server injects a test identity and is intentionally loopback-only.

## Storage and backups

D1 stores structured data and R2 stores bytes. Files have generated opaque keys and metadata in D1. No user content is stored in browser local storage. In-progress test choices use session storage for the same tab; submitted results are server records.

Before production use, establish a backup policy with your hosting administrator:

1. Schedule D1 exports or supported point-in-time recovery.
2. Retain versioned copies of R2 objects and metadata consistently.
3. Test restore into a separate private environment.
4. Verify enrollments, payment totals, attachment downloads and result snapshots after restore.
5. Record retention periods and authorized operators.

No automatic backup job or external monitoring service has been configured by this delivery.

## Operational checks

- Track API errors, D1 query latency, Worker CPU/memory and R2 upload failures.
- Add rate limits before untrusted large-scale access.
- Scan uploads before opening them on staff devices; automatic malware scanning is not included.
- Orphaned uploads can occur if someone uploads then abandons a form. Add a scheduled cleanup job only after verifying that no content/submission references the file.
- Admin exports currently read at most 5,000 rows per table; add paginated APIs and asynchronous exports before this cap is reached.
- Financial entries are append-only in the interface. Correct mistakes using a reviewed data migration with an audit entry; add an explicit adjustment workflow if finance operations require it.

## Security assumptions

Server authorization and SQL parameterization protect application records. Test answers remain server-side until submission. File downloads enforce access and attachment disposition. A restrictive content security policy is applied. Google Fonts is the only optional visual external request; system fonts provide fallback.

No payment processor, notification service, malware scanner, proctoring or MFA policy has been configured. Google OAuth implementation requires the activation steps in CAMPUS-UPGRADE.md. Sites provides the identity and audience layer. Choose organization policies before enrolling real students.

## Release checklist

- Review syllabus and assessment answers; replace starter content where appropriate.
- Verify meeting/recording URLs and Drive sharing for actual students.
- Configure fees in the correct currency before first student sign-in.
- Validate student and admin flows on desktop Chrome, Safari and Android Chrome.
- Verify focus navigation, dialogs, mobile menu, installation and downloads.
- Test a separate student account in two batches and ensure cross-batch isolation.
- Confirm backup and restore operations, capacity expectations and privacy retention.


## Campus upgrade
See [CAMPUS-UPGRADE.md](CAMPUS-UPGRADE.md) for the current authentication, mixed-question assessments, server autosave, Azure engine activation and Google Group setup. See [UPGRADE-ARCHITECTURE.md](UPGRADE-ARCHITECTURE.md) for the integration diagram. These upgrade documents supersede earlier provider-specific setup notes.
