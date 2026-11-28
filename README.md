# thousands

A Foundry VTT module for the Pathfinder Second Edition system that supports a Strength of Thousands campaign, centered on the Magaambya academia subsystem.

Targets Foundry VTT 14 (verified on 14.370) and the PF2e system 8.7.0 or later.

## Installing via Manifest URL

1. In the Foundry VTT setup screen, open the **Add-on Modules** tab and click **Install Module**.
2. Paste the manifest URL into the **Manifest URL** field at the bottom of the dialog and click **Install**:
   ```text
   https://github.com/achris/thousands/releases/latest/download/module.json
   ```
3. Launch your Pathfinder 2e world, open **Settings → Manage Modules**, enable **Strength of Thousands**, and save module settings.

To install a specific version instead of the latest release, replace `latest/download/module.json` with `download/<tag>/module.json` (for example, `v0.1.0`), or download `module.zip` from that release and extract it into `<Foundry user data>/Data/modules/thousands`.

## GM Workflow

1. **Character setup**: At campaign start, have each player add `Academic Rank: Initiate`, one `Primary Branch: <Branch>` feat, and one `Secondary Branch: <Branch>` feat from the **Academia Feats** (`thousands.academia-feats`) compendium pack onto their character sheet's **Feats** tab (under Bonus Feats).
   - **Orientation Magic Symbols** (Book 1 pp. 10–11): when Takulu offers the symbols, have each player add the `Orientation Symbol` feat and pick a symbol or **No Symbol**. A symbol's at-will innate cantrip (Light, Guidance, Telekinetic Hand, Message, Shield, or Stabilize, the PF2e remaster names) must be added manually as an innate spell of the tradition shown in its choice label until the character learns another cantrip; **No Symbol** applies a +1 status bonus to saving throws against spells until level 2.
2. **Opening a study period**: When the adventure reaches a downtime study period, announce the opportunity and reference the PF2e system's `Study`, `Cram`, or `Practical Research` entries in the _Adventure-Specific Actions_ compendium:
   - **Study** (ranks: Initiate, Attendant, Conversant): one skill check using an associated skill of the chosen branch against the standard level-based DC for that branch's current level (levels 0–20 map to DCs 14–40).
   - **Cram** (ranks: Initiate, Attendant, Conversant): requires at least one branch to be 2 or more levels below its cap; performs Study twice. Until the character next takes Study, prompt or automatically roll a DC 8 flat check (`@Check[flat|dc:8]`) at the start of each adventuring day and apply `Fatigued` on a failure.
   - **Practical Research** (ranks: Conversant, Lore-Speaker): uses the check and rewards specified by the adventure for that research opportunity. As the GM, run `/research` in chat (or `game.modules.get("thousands").api.research()` from a macro), pick the character, optionally a site preset, branch, and either a skill and DC to roll or an outcome entered directly (plus an optional free-text note for unique rewards), then click **Apply** on the resulting chat card. While a critical-failure skip is pending, `/research` instead posts a skipped-opportunity card for the GM to **Apply**.
     - **Site presets** cover Bloodsalt (Book 3 p. 23), Prison of the Vacant Eye (Book 3 p. 51), Mzali Necropolis (Book 4 p. 15), Osibu (Book 4 pp. 52–53), Red Star Doorway (Book 5 p. 22), Hall of Reason (Book 5 pp. 42–43), and The Endless Table (Book 6 p. 28). A preset limits skills to the branch's and the site's, fills in the DC (+5 at Hall of Reason, where a researcher without **Has Telepathy** gets a result one degree worse), and lets The Endless Table raise any branch to 20. The chat card shows site rewards and penalties before and after **Apply**, which records the site and result (including lockouts), tracks Osibu Treasure Points (0–4) and the cumulative –2 at The Endless Table (added to later rolls there), and applies doomed 1 (Mzali Necropolis) or drained 2 (Hall of Reason) on a critical failure. Enforcing lockouts, durations, ending conditions, and spending Treasure Points remain manual.
3. **Applying outcomes and caps**: A primary branch's cap equals the character's level; a secondary branch's cap equals half the character's level (rounded down).
   - **Critical Success**: +2 branch levels, clamped to the branch's cap.
   - **Success**: +1 branch level, clamped to the branch's cap.
   - **Star rule**: If a success or critical success would push a branch above its current cap (below level 20), have the player add the `Branch Star: <Branch>` feat. On the character's next level-up, the branch rises to its new cap and the star feat is removed.
   - **Failure**: No change.
   - **Critical Failure**: No change, and the character must skip their next Study opportunity. At a Practical Research site preset, the site's own consequence applies instead; only Bloodsalt also sets the skip.
4. **Rank advancement and Perquisite**: When characters advance in academic rank (such as reaching Attendant at the First Masking in Book 1 pp. 44–45, Conversant, or Lore-Speaker), run `/promote` in chat (or `game.modules.get("thousands").api.promote()` from a macro), pick a character or **Whole party** (targeting the PF2e active party's character members), choose the new rank, and click **Apply** on the resulting chat card. Promotion is upgrade-only: applying replaces any lower `Academic Rank` feat in place so only one rank feat is owned at a time, skips characters already at or above the chosen rank, and re-evaluates `Dedicated Attendant` on sheets that already hold a level 3 branch benefit. Once a character is Attendant or higher, `Dedicated Attendant` automatically grants PF2e's `Magaambyan Attendant Dedication` and the companion `Magaambyan Attendant Dedication Rules` feat (players who take the dedication directly can drag the companion from **Academia Feats**) to automate the Arcana/Nature proficiency upgrade and halcyon cantrip tradition choice. Sheets that already hold an older `Dedicated Attendant` feat from a prior release should remove and re-add that feat from **Academia Feats** so it carries the updated companion-feat rule. Verify Perquisite completion before a character claims a level 3 `Dedicated Attendant` benefit feat.
5. **Spire Dormitory Classroom Advantages**: Use `/befriend` to track each character's standing with the nine Spire Dormitory fellow students (see **Befriending Spire Dormitory Students** below). Reaching the befriended threshold automatically grants `Classroom Advantage: <Student>` from the **Academia Feats** compendium when you click **Apply** (or players can drag the feat manually). Each feat links that student's unlocked spell, item, or witch lesson, and `/study` automatically applies owned Classroom Advantages during Study and Cram (degree upgrades/downgrades, 3-check Rain-Scribes Cramming with Haibram Thodja, Cram fatigue immunity with Chizire or Okoro Obiyo, and Mariama Keitana's toggleable 1/day Cascade Bearers Study fortune reroll).
6. **Opting out of the subsystem (optional variant)**: Under **Configure Settings**, enable **Auto-advance primary branch on even levels** (default off) to replace Study and Cram rolls with automatic primary-branch advancement of +1 level at each even character level, posting a chat card for the GM to **Apply**. **Auto-advance primary branch cap** defaults to `10` (the 10 even levels from 2 through 20) and can be raised to `11` to match the adventure sidebar's printed maximum at level 20.

## Player Workflow

1. **Choose branches**: Drag `Academic Rank: Initiate`, your chosen `Primary Branch: <Branch>`, and your chosen `Secondary Branch: <Branch>` from the **Academia Feats** compendium onto the **Bonus Feats** section of your character sheet.
2. **Roll Study or Cram checks**: During a study period, pick a branch you want to advance and roll one of its associated skills against the level-based DC for that branch's current level:
   - **Cascade Bearers**: Arcana, Occultism, Religion (_Academia Lore_)
   - **Emerald Boughs**: Deception, Diplomacy, Society (_settlement Lore_)
   - **Rain-Scribes**: Medicine, Nature, Survival (_terrain Lore_)
   - **Tempest-Sun Mages**: Intimidation, Performance (_Warfare Lore_)
   - **Uzunjati**: Crafting, any Lore
3. **Claim branch benefits**: For each branch level gained (1–20), drag the matching `<Branch> (Level <N>): <Benefit>` feat from the **Academia Feats** compendium onto your sheet:
   - PF2e rule elements automatically grant bonus feats (`Additional Lore`, `Magaambyan Attendant Dedication`, 6th/10th-level branch feats, and general feats), prompt for skill feats or fallback feats, upgrade skill proficiencies, and add roll notes.
   - Follow any `Manual:` note in the feat's description (for example, naming a granted Lore skill on your sheet or tracking 1/day uses for `Make Your Own Luck` and `Magical Paragon`).
4. **Toggle situational bonuses**: On your character sheet's **Actions** tab, toggle **Steeped in History** when rolling Recall Knowledge about the Magaambya or your branch, and toggle **Branch Influence** when making Deception, Diplomacy, Intimidation, or Performance checks with members of that branch.
5. **Befriend Spire Dormitory peers**: Run `/befriend` in chat to view your character's current attitude and notes with each of the nine fellow students and, when skill check rolls are enabled, roll a check to improve standing.

## Rolling Study and Cram

With the character's token selected (or as the player assigned to it), type `/study` in chat, or run
`game.modules.get("thousands").api.study()` from a macro. Pick a branch and skill and choose
**Study** or **Cram** (enabled when a branch is at least 2 levels below its cap); Cram prompts a
second check using the branch level the first check would reach. Each check's chat message shows the
change it would make, and the GM clicks **Apply** to grant the benefit feats, branch star, skip
flag, and Cram fatigue flag (cleared on the character's next Study). When a character's level rises,
each starred branch whose cap increases posts a chat card for the GM to **Apply** (granting the new
branch level benefit feat and removing the `Branch Star` feat). After PF2e's **Rest for the Night**,
any character carrying the Cram fatigue flag receives a `@Check[flat|dc:8]` chat prompt (or, when
**Auto-roll Cram fatigue check after rest** is enabled, automatically rolls the DC 8 flat check
on the client that rested) whose roll card lets the GM **Apply** the `Fatigued` condition on a failure.
**Practical Research** results use the same **Apply** workflow (see step 2 above). GM world settings under
**Configure Settings** control whether both Cram checks require a branch 2+ levels below its cap and
whether a critical-failure skip also consumes a Cram opportunity (both default to on), whether
**Rest for the Night** automatically rolls the Cram fatigue flat check (default off), and
the optional even-level primary-branch auto-advance variant (default off, cap 10 or 11).

## Befriending Spire Dormitory Students

Type `/befriend` in chat, or run `game.modules.get("thousands").api.befriend()` from a macro, to view and update standings with the nine Spire Dormitory students (Anchor Root, Chizire, Esi Djana, Haibram Thodja, Ignaci Canterells, Mariama Keitana, Noxolo, Okoro Obiyo, and Tzeniwe). Standings are stored per character in actor flags on the standard PF2e attitude track (**Hostile** → **Unfriendly** → **Indifferent** → **Friendly** → **Helpful**), starting at **Indifferent** (or at the befriended threshold if the character already owns that student's `Classroom Advantage` feat).

- **Players**: Select your token (or use your assigned character) and run `/befriend` to review all nine students' current attitudes and latest notes. When rolling is enabled, pick a student, skill (defaulting to Diplomacy), DC, and an optional short note (such as a campus task or peer favor) to roll a check. Critical Success shifts attitude up 2 steps, Success shifts up 1 step, Failure leaves attitude unchanged, and Critical Failure shifts down 1 step.
- **GMs**: Run `/befriend` to inspect any character (or switch between characters and a **Whole party** overview). You can either roll a check for a specific character or record a direct standing change (`+1 step`, `+2 steps`, `-1 step`, or `Set to <Attitude>`) with an optional note for either one character or the whole party at once—useful for shared service projects, extracurricular favors, or roleplay milestones.
- **Applying results**: Both rolled checks and GM-recorded updates post a chat card showing the attitude change, note, and any change in befriended status. Click **Apply** on the chat card to commit the update. Reaching the befriended threshold automatically grants that student's `Classroom Advantage: <Student>` bonus feat (which links their unlocked uncommon spell, item, or witch lesson); dropping below the threshold removes the feat, and rerolling a check lets **Apply** cleanly replace the previous outcome.
- **GM settings** (under **Configure Settings**):
  - **Befriend: allow skill check rolls** (default on): Disable to hide the roll option and skill/DC fields, leaving GM-recorded standing changes only (players still use `/befriend` as a read-only standings view).
  - **Befriend: attitude required to befriend** (default **Helpful**): Choose whether a student counts as befriended at **Helpful** or **Friendly**.

## Local development

Requires Node.js 22 or later and `zip` / `unzip`.

```sh
npm ci
npm run lint                # ESLint and Prettier check
npm run typecheck           # TypeScript
npm test                    # Vitest (builds dist/, verifies manifest, pack, and release archive; downloads and caches PF2e's json-assets.zip, set PF2E_DATA_DIR to relocate the cache)
npm run build               # writes the module to dist/
npm run package -- v0.1.0   # stamps dist/module.json for a tag and writes module.zip
npm run format              # apply Prettier
```

To test a local build in Foundry VTT without a release archive, build the module and copy or symlink `dist/` into Foundry's user data as `Data/modules/thousands`:

```sh
npm run build
ln -s "$(pwd)/dist" "<Foundry user data>/Data/modules/thousands"
```

Use `cp -r dist "<Foundry user data>/Data/modules/thousands"` instead of a symlink if you prefer a copy. Restart Foundry, then enable **Strength of Thousands** in a PF2e world.

## Licence and Paizo notice

The code in this repository is licensed under the MIT License (see [LICENSE](LICENSE)).

This module uses trademarks and/or copyrights owned by Paizo Inc., used under Paizo's Community Use Policy (paizo.com/licenses/communityuse). We are expressly prohibited from charging you to use or access this content. This module is not published, endorsed, or specifically approved by Paizo. For more information about Paizo Inc. and Paizo products, visit paizo.com.

This module references material from _Pathfinder Adventure Path #169: Kindled Magic_ (Strength of Thousands, Book 1) by Alexandria Bustion and Eleanor Ferron, with additional writing by Shanyce Henley, Jenny Jarzabski, Jessica Redekop, and Mark Seifter.

## Contact

Module by [achris](https://github.com/achris). For questions or bug reports, please open an issue on the [GitHub Issues page](https://github.com/achris/thousands/issues).
