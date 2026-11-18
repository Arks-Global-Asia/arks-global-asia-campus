# Extension roadmap

The current implementation is a working first release for a single institution, with separate batches and server-stored records. These are optional next additions, not features represented as complete:

1. **Cohort launch:** confirm access policy, review real curriculum, add instructors, dates, fees and meeting links.
2. **Native Android distribution:** verified domain, trusted web activity or Capacitor shell, Android Studio build, signing key, Digital Asset Links, store assets and Play Console submission. No APK/AAB is generated in this release.
3. **Communications:** email invitations and reminders through a chosen provider, delivery logs and opt-out preferences.
4. **Payments:** hosted checkout, signed webhooks, reconciliation, refunds and tax invoices through a selected payment processor.
5. **Teaching:** attendance, instructor-specific roles, richer discussion threads, rubric scoring and certificates.
6. **Scale:** database pagination, versioned curricula, background exports, load tests, monitoring, file scanning and lifecycle cleanup.
7. **Assessment administration:** question randomization, per-test attempt policies, authorized reset workflow and scheduling windows.
8. **Finance controls:** reviewed enrollment fee amendments and ledger adjustment entries.

A future cohort requires only new data, not a separate deployment. Multiple independent institutions would need an additional tenant key and authorization boundary.
