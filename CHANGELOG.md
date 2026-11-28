# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

### Added

- Module scaffold targeting Foundry VTT 14 (verified on 14.370) and the Pathfinder Second Edition system 8.7.0 or later.
- Pure academia subsystem rules engine (`src/rules/`) covering the five Magaambya branches, level-based DCs (levels 0–20), primary and secondary branch caps, Study / Cram / Practical Research eligibility and outcome calculation, star carry-over on level-up, and critical-failure skip tracking.
- **Academia Feats** (`thousands.academia-feats`) compendium pack with 130 bonus feats:
  - 4 Academic Rank feats (`Initiate`, `Attendant`, `Conversant`, `Lore-Speaker`).
  - 5 Primary Branch feats, 5 Secondary Branch feats, and 5 Branch Star feats.
  - 100 branch benefit feats (levels 1–20 across all 5 branches) with PF2e rule elements (`GrantItem`, `ChoiceSet`, `FlatModifier`, `ActiveEffectLike`, `RollOption`, and `Note`).
  - 9 Spire Dormitory Classroom Advantage feats, applied automatically by `/study` (Study and Cram).
  - `Orientation Symbol` feat (Book 1 pp. 10–11) with a `ChoiceSet` of Takulu's 6 Orientation Magic Symbols (each naming its at-will innate cantrip and tradition on the feat) or no symbol for a +1 status bonus to saving throws against spells at character level 1.
  - `Magaambyan Attendant Dedication Rules` companion feat (Book 1 pp. 44–45), granted by `Dedicated Attendant`, automating the Arcana/Nature proficiency upgrade and halcyon tradition choice.
- Academic Rank promotion (`/promote` and `game.modules.get("thousands").api.promote()`): GM-only, upgrade-only promotion of one character or the active PF2e party, replacing the rank feat on chat-card **Apply**.
- Spire Dormitory student befriending tracker (`/befriend` and `game.modules.get("thousands").api.befriend()`): per-character PF2e attitude tracking with short notes, GM whole-party updates, optional skill-check rolls (toggleable in GM settings), configurable befriended threshold (`Helpful` or `Friendly`), and automatic granting/removal of `Classroom Advantage` feats on chat-card **Apply**.
- `/research` site presets for the seven Books 3–6 Practical Research sites, with site skills and DCs, Hall of Reason telepathy, level-20 advancement at The Endless Table, Osibu Treasure Points, recorded lockouts and penalties, and automatic doomed 1 / drained 2 on site critical failures.
- Tag-triggered GitHub release workflow (`.github/workflows/release.yml`) and packaging script (`scripts/package-release.mjs`) that stamps `version`, `manifest`, and `download` URLs into `dist/module.json` and packages `dist/` into `module.zip`.
- MIT `LICENSE` and Paizo Community Use Policy notice.
