# Domain Packs

Domain packs contribute domain-specific routing policy, skills, structured artifacts, validators, workflows, and eval metadata through the generic Core API. Core owns registration, recommendation mechanics, verification outcomes, bounded repair requests, artifacts, and evaluation execution. It does not own frontend, backend, mobile, or other domain policy.

Bundled packs are trusted code shipped with SkillRanger. Skills remain self-contained install units. A skill that uses domain-level concepts must include every execution file it needs inside its own package so checksum, audit, install, and lockfile behavior remain complete.

The frontend pack is the reference implementation under `domains/frontend` and `src/domains/frontend`.
