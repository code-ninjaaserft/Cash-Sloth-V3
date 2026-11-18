# Preliminary licensing review — FSSL-1.0

This review records the proposal as of 2026-11-12. Cash Sloth V3 subsequently
adopted the [final FSSL-1.0](../../LICENSE) on 2026-11-18.

The full [proposed LICENSE text](LICENSE-FSSL-1.0.proposed.md) is deliberately kept
outside root `LICENSE`. No package metadata or existing rights were changed to
claim FSSL adoption. The README section describes the proposal, not a grant.

## Local evidence

- `git log --all` and `git rev-list --all --count` show one reachable commit:
  `766f9f2a06995f9695d5ebb7fe6173856a5a8395`, dated 2026-11-11, Initial commit.
- Its tree contains only a two-line README (`# Cash-Sloth-V3` and `CSV3`). The
  inspected commit has no license text. Local `origin` / `origin/main` refs exist.
- The project source is currently untracked and README modified. This supports
  that the current application is absent from the inspected reachable Git history;
  it does not exclude unreachable/deleted commits or prove that no material has
  ever been pushed, hosted publicly or shared elsewhere.
- No first-party LICENSE/LICENCE/NOTICE file or MIT project notice was found in
  the current project scan. First-party package manifests are private and do not
  declare a project license. Dependency MIT notices are not a license of Cash Sloth.
- No fetch, push, GitHub visibility check or remote publication was performed.

These facts qualify the owner's statement that the repository has never been
committed. They do not establish an earlier license, ownership or publication state.

## Consistency findings

1. A commercial-use restriction and permission requirement for redistribution
   make this a Source-Available proposal, not OSI Open Source. OSI's definition
   requires unrestricted redistribution and use across fields, including business.
   [Open Source Definition](https://opensource.org/osd)
2. Public GitHub hosting has independent platform terms for viewing and in-service
   forks. An absolute ban on every public fork cannot simply override those
   platform grants. The draft preserves independently granted platform rights;
   choose a suitable hosting policy before publishing.
   [GitHub Terms, section D.5](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service#5-license-grant-to-other-users)
3. The draft defines private non-commercial use narrowly as personal use by a
   natural person. Clubs, nonprofit events and organizations require permission
   under this proposed interpretation. This is a drafting choice for review, not
   a conclusion about the owner's intended business model.
4. Keeping brand assets entirely outside every permission could prevent even
   normal private execution of the supplied UI. The draft reserves branding but
   permits incidental unchanged copies in permitted private builds/backups and
   their in-app display. Public inspection is also expressly available to business
   readers; commercial execution still requires separate authorization.
5. Copyright holder identity is supplied by the owner, not independently proven.
   Check contribution/contract/employment rights and asset provenance. Swiss IPI
   identifies source code as copyright-protectable; that does not establish
   ownership of each generated or contributed element in this repository.
   [Swiss IPI overview](https://www.ige.ch/en/protecting-your-ip/copyright/the-basics)
6. Existing third-party permissions cannot be restricted by calling the whole
   distribution FSSL. Their original licenses, notices and any source obligations
   remain separate. No third-party file or notice was edited by this review.

## Dependency review

Run `node scripts/audit-licenses.mjs 2026-11-12` to regenerate the read-only local
[inventory](third-party-inventory.json). The installed Windows snapshot has 150
unique package versions: 112 MIT, 20 Apache-2.0, six BSD-2-Clause, two BSD-3-Clause,
seven ISC, two MPL-2.0 and one BlueOak-1.0.0 declarations. Metadata alone is not a
legal clearance or a complete cross-platform/bundled-component SBOM.

Electron's supplied runtime `LICENSE` and `LICENSES.chromium.html` are inventoried
with hashes. Preserve them when packaging, together with all required dependency
license/copyright/NOTICE text. The inventory reports seven packages without a
top-level notice file; some may carry text elsewhere. Resolve their exact upstream
notices and packaging treatment before distribution rather than replacing them
with FSSL or assuming a metadata string is sufficient.

The two declared MPL components are `lightningcss` and its installed Windows
binding. They are build-tool dependencies in the current workspace. Their presence
does not by itself establish that their code is redistributed in the app. Review
the actual shipped artifact; if MPL-covered material is distributed, applicable
notice/source obligations must be met without restricting the covered source's
independent rights. [Mozilla MPL FAQ](https://www.mozilla.org/en-US/MPL/2.0/FAQ/)

No new dependency was installed for this review. Installer/distribution clearance
and license-notice packaging remain release-stage work, not completed claims.

## Questions before approval

- Should private non-commercial use include nonprofit clubs, internal association
  use, charity events, schools or cost-recovery sales? The current proposal excludes
  them unless authorized. Define tests/evaluation by prospective commercial users.
- Is the platform-fork exception acceptable? If every public copy must require
  individual authorization, reconsider public GitHub hosting before publication.
- Should private sharing with family, collaborators or nonprofit organizations be
  permitted? The current proposal allows personal backups but no such redistribution.
- What contact and evidence process will issue written commercial/redistribution
  permission? No email, price or authorization process was invented.
- Should breach have a notice/cure period or automatic reinstatement? The proposal
  requires written reinstatement, subject to mandatory rights.
- Which governing law, dispute forum and consumer/warranty rules apply? The draft
  leaves these unset rather than claiming enforceability under Swiss or other law.
- Are all code contributions and original art controlled by Armon Flurin Elvedi?
  Check employer/contract rights, AI-assisted work, and third-party marks appearing
  inside the official logo. No ownership of those third-party marks is asserted.
- Which precise code/docs/assets and versions will be covered on adoption? Review
  source/binary distribution, patent issues, contribution terms and bundled notices.

Owner approval of a precise final text and scope is required before installing a
root LICENSE, changing package license declarations, committing, or publishing it.
No approval is inferred from the implementation request or from elapsed time.
