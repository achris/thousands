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
2. **Opening a study period**: When the adventure reaches a downtime study period, announce the opportunity and reference the PF2e system's `Study`, `Cram`, or `Practical Research` entries in the _Adventure-Specific Actions_ compendium:
   - **Study** (ranks: Initiate, Attendant, Conversant): one skill check using an associated skill of the chosen branch against the standard level-based DC for that branch's current level (levels 0–20 map to DCs 14–40).
   - **Cram** (ranks: Initiate, Attendant, Conversant): requires at least one branch to be 2 or more levels below its cap; performs Study twice. Until the character next takes Study, prompt a DC 8 flat check (`@Check[flat|dc:8]`) at the start of each adventuring day and apply `Fatigued` on a failure.
   - **Practical Research** (ranks: Conversant, Lore-Speaker): uses the check and rewards specified by the adventure for that research opportunity.
3. **Applying outcomes and caps**: A primary branch's cap equals the character's level; a secondary branch's cap equals half the character's level (rounded down).
   - **Critical Success**: +2 branch levels, clamped to the branch's cap.
   - **Success**: +1 branch level, clamped to the branch's cap.
   - **Star rule**: If a success or critical success would push a branch above its current cap (below level 20), have the player add the `Branch Star: <Branch>` feat. On the character's next level-up, the branch rises to its new cap and the star feat is removed.
   - **Failure**: No change.
   - **Critical Failure**: No change, and the character must skip their next Study opportunity.
4. **Rank advancement and Perquisite**: When characters advance in academic rank in the adventure, have them replace their `Academic Rank` feat with `Attendant`, `Conversant`, or `Lore-Speaker`. Verify Perquisite completion before a character claims a level 3 `Dedicated Attendant` benefit feat.

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

## Rolling Study and Cram

With the character's token selected (or as the player assigned to it), type `/study` in chat, or run
`game.modules.get("thousands").api.study()` from a macro. Pick a branch and skill and choose
**Study** or **Cram** (enabled when a branch is at least 2 levels below its cap); Cram prompts a
second check using the branch level the first check would reach. Each check's chat message shows the
change it would make, and the GM clicks **Apply** to grant the benefit feats, branch star, skip
flag, and Cram fatigue flag (cleared on the character's next Study). Two GM world settings under
**Configure Settings** control whether both Cram checks require a branch 2+ levels below its cap and
whether a critical-failure skip also consumes a Cram opportunity (both default to on).

## Local development

Requires Node.js 22 or later and `zip` / `unzip`.

```sh
npm ci
npm run lint                # ESLint and Prettier check
npm run typecheck           # TypeScript
npm test                    # Vitest (builds dist/, verifies manifest, pack, and release archive)
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
