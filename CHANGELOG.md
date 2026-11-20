# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

### Added

- Module scaffold targeting Foundry VTT 14 (verified on 14.370) and the Pathfinder Second Edition system 8.7.0 or later.
- Pure academia subsystem rules engine (`src/rules/`) covering the five Magaambya branches, level-based DCs (levels 0–20), primary and secondary branch caps, Study / Cram / Practical Research eligibility and outcome calculation, star carry-over on level-up, and critical-failure skip tracking.
- **Academia Feats** (`thousands.academia-feats`) compendium pack with 128 bonus feats:
  - 4 Academic Rank feats (`Initiate`, `Attendant`, `Conversant`, `Lore-Speaker`).
  - 5 Primary Branch feats, 5 Secondary Branch feats, and 5 Branch Star feats.
  - 100 branch benefit feats (levels 1–20 across all 5 branches) with PF2e rule elements (`GrantItem`, `ChoiceSet`, `FlatModifier`, `ActiveEffectLike`, `RollOption`, and `Note`).
  - 9 Spire Dormitory Classroom Advantage feats, applied automatically by `/study` (Study and Cram).
- Tag-triggered GitHub release workflow (`.github/workflows/release.yml`) and packaging script (`scripts/package-release.mjs`) that stamps `version`, `manifest`, and `download` URLs into `dist/module.json` and packages `dist/` into `module.zip`.
- MIT `LICENSE` and Paizo Community Use Policy notice.
